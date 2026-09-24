#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { wilson } from "./lib/web-stress-fixture.mjs";

// Blind adjudication and agreement audit for the LLM-review holdout (PROCESS.md steps
// 3.5-3.7). A pinned adjudicator (not the reviewer, not the labeller) runs through
// opencode in parallel groups under a USD cap measured on the opencode OpenRouter key.
// It sees the venue record and candidate URL only; for disputed items it also sees
// both claims as A/B in seeded random order, never which one is the label.

const argv = process.argv.slice(2);
const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const cap = Number(arg("--budget-usd", NaN));
if (!(cap > 0)) throw new Error("--budget-usd is required");
const model = arg("--model", "openrouter/deepseek/deepseek-v4-pro");
if (/mimo|muse-spark/i.test(model)) throw new Error("the adjudicator must be neither the reviewer nor the labeller");
const concurrency = Number(arg("--concurrency", 4));
const runId = arg("--run-id", "holdout-v1");
const holdout = resolve("benchmark/llm-review-holdout-v1");
const work = resolve("data/holdout-adjudication");
mkdirSync(work, { recursive: true });
const seeded = (seed) => { let n = 0; return () => createHash("sha256").update(`${seed}:${n++}`).digest().readUInt32LE(0) / 2 ** 32; };

const venues = new Map(readdirSync(join(holdout, "labelling")).filter((name) => name.startsWith("packet-"))
  .flatMap((name) => JSON.parse(readFileSync(join(holdout, "labelling", name), "utf8")).venues)
  .map((venue) => [venue.venue_id, venue]));
const raw = JSON.parse(readFileSync(join(holdout, "RAW-EVALUATION.json"), "utf8"));
const store = new EvidenceStore(resolve(`data/llm-review/${runId}.sqlite`));
const accepted = store.listLlmReviewOutcomes(runId).filter((row) => row.outcome === "accepted");
store.close();
const publishedVenues = [...new Set(accepted.map((row) => row.venue_id))].sort();
const auditSize = Math.max(15, Math.ceil(publishedVenues.length * 0.2));
const random = seeded(`${runId}-agreement-audit`);
const pool = [...publishedVenues];
for (let index = pool.length - 1; index > 0; index--) {
  const swap = Math.floor(random() * (index + 1));
  [pool[index], pool[swap]] = [pool[swap], pool[index]];
}
const items = [
  ...pool.slice(0, auditSize).map((venueId) => ({ kind: "agreement_audit", venue_id: venueId,
    final_url: accepted.find((row) => row.venue_id === venueId).final_url })),
  ...raw.candidate_audit.false_rejections.map((row) => ({ kind: "disputed_rejection", venue_id: row.venue_id,
    final_url: row.final_url })),
  ...raw.false_publications.map((row) => ({ kind: "disputed_publication", venue_id: row.venue_id,
    final_url: row.predicted_url })),
].map((item, index) => {
  const venue = venues.get(item.venue_id);
  const blind = { item_id: `item-${String(index + 1).padStart(2, "0")}`, venue: { name: venue.name,
    aliases: venue.aliases, address: venue.address, postcode: venue.postcode, municipality: venue.municipality,
    phone: venue.phone }, candidate_url: venue.candidate_url, final_url_seen_by_crawler: item.final_url };
  if (item.kind !== "agreement_audit") {
    const claims = ["The candidate's domain is this venue's official website.",
      "The candidate's domain is not this venue's official website."];
    if (random() < 0.5) claims.reverse();
    blind.claims = { A: claims[0], B: claims[1] };
  }
  return { ...item, blind };
});

const groups = Array.from({ length: Math.min(concurrency, items.length) }, () => []);
items.forEach((item, index) => groups[index % groups.length].push(item));
const key = JSON.parse(readFileSync(join(homedir(), ".local/share/opencode/auth.json"), "utf8")).openrouter.key;
const usage = async () => {
  await new Promise((done) => setTimeout(done, 20_000));
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  return Number((await response.json()).data.usage);
};
const worstCasePerGroup = 0.5; // stop before starting a wave that could cross the cap
if (groups.length * worstCasePerGroup > cap) throw new Error("cap too small for one parallel wave");
const before = await usage();
await Promise.all(groups.map((group, index) => new Promise((done) => {
  const input = join(work, `group-${index + 1}.json`);
  const output = join(work, `verdicts-${index + 1}.json`);
  if (existsSync(output)) return done();
  writeFileSync(input, `${JSON.stringify(group.map((item) => item.blind), null, 2)}\n`);
  const prompt = [
    "You are an independent adjudicator deciding whether websites are the official websites of Italian food venues.",
    `Read ${input}. For every item, open the candidate URL on the live web (and its contact/about pages; search the web if needed).`,
    "Official means the business operating this venue controls the domain and uses it for this venue (its own site, the hotel/agriturismo/group running it, or a chain site listing this exact location).",
    "Directories, social profiles, booking/delivery/menu platforms, editorial pages, other businesses, other branches, and parked or dead domains are not official.",
    "Where an item has claims A and B, decide which claim is correct.",
    "Read no other file in this repository. Do not run git.",
    `Write ${output} as a JSON array with one object per item: {"item_id", "verdict": "official"|"not_official"|"uncertain",`,
    '"correct_claim": "A"|"B"|null, "publisher_class", "evidence_urls": [...], "rationale": "what matched or contradicted"}.',
    `Then run \`node -e 'JSON.parse(require("fs").readFileSync("${output}", "utf8"))'\` and fix the file until it parses.`,
  ].join("\n");
  const child = spawn("opencode", ["run", "-m", model, prompt], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (data) => { log += data; });
  child.stderr.on("data", (data) => { log += data; });
  const timer = setTimeout(() => child.kill(), 60 * 60_000);
  child.on("close", () => { clearTimeout(timer); writeFileSync(join(work, `opencode-${index + 1}.log`), log); done(); });
})));
const spent = (await usage()) - before;

const verdicts = new Map(groups.flatMap((_, index) => {
  const path = join(work, `verdicts-${index + 1}.json`);
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return []; }
}).map((verdict) => [verdict.item_id, verdict]));
const results = items.map((item) => {
  const verdict = verdicts.get(item.blind.item_id) || null;
  const official = verdict?.verdict === "official";
  const claimOfficial = verdict?.correct_claim && item.blind.claims?.[verdict.correct_claim]?.startsWith("The candidate's domain is this");
  return { kind: item.kind, venue_id: item.venue_id, item_id: item.blind.item_id, candidate_url: item.blind.candidate_url,
    adjudicated: verdict ? (item.kind === "agreement_audit" ? verdict.verdict
      : claimOfficial ? "official" : verdict.correct_claim ? "not_official" : verdict.verdict) : "missing",
    verdict, publication_error: item.kind === "agreement_audit" && verdict?.verdict === "not_official" };
});
const audit = results.filter((row) => row.kind === "agreement_audit");
const auditErrors = audit.filter((row) => row.publication_error).length;
const disputedPublicationsFalse = results.filter((row) => row.kind === "disputed_publication"
  && row.adjudicated !== "official").length;
const falsePublications = auditErrors + disputedPublicationsFalse;
const correct = raw.venue_metrics.true_publications + results.filter((row) => row.kind === "disputed_publication"
  && row.adjudicated === "official").length - auditErrors;
const conclusive = correct + falsePublications;
const bound = wilson(correct, conclusive);
const complete = results.every((row) => row.adjudicated !== "missing");
const report = {
  schema_version: 1, run_id: runId, adjudicated_at: new Date().toISOString(), adjudicator: `${model} via opencode`,
  adjudicator_spend_usd: Number(spent.toFixed(4)), budget_usd: cap,
  agreement_audit: { publications: publishedVenues.length, sampled: audit.length, errors: auditErrors,
    uncertain: audit.filter((row) => row.adjudicated === "uncertain").length },
  disputes: results.filter((row) => row.kind !== "agreement_audit").map(({ kind, venue_id, candidate_url, adjudicated }) =>
    ({ kind, venue_id, candidate_url, adjudicated })),
  gate: { correct_automatic_verifications: correct, false_automatic_verifications: falsePublications,
    wilson_95: bound, adjudication_complete: complete,
    passed: complete && correct >= 73 && falsePublications === 0 && bound.lower >= 0.95 },
  items: results,
};
writeFileSync(join(holdout, "ADJUDICATED-GATE-REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, items: undefined }, null, 2));
