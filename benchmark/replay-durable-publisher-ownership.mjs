#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EvidenceStore } from "../lib/evidence-store.mjs";
import { registrableDomain } from "../lib/publisher-ownership.mjs";

export function replayDurablePublisherOwnership({ sourceDbPath, copyDbPath, selectionPath, pilot }) {
  copyFileSync(resolve(sourceDbPath), resolve(copyDbPath));
  const selectionBytes = readFileSync(resolve(selectionPath));
  const selection = JSON.parse(selectionBytes);
  const reviewed = new Map(selection.candidates.map((row) => [row.venue_id, row]));
  const store = new EvidenceStore(resolve(copyDbPath), { clock: () => new Date("2026-09-02T00:00:00.000Z") });
  try {
    const imported = store.importPublisherReviews(selection, {
      selectionFingerprint: createHash("sha256").update(selectionBytes).digest("hex"),
    });
    const facts = store.db.prepare(`SELECT v.venue_id, v.display_name, f.fact_key, f.payload_json
      FROM facts f JOIN venues v USING (venue_id)
      WHERE f.kind = 'website' AND f.decision_status = 'accepted' AND f.lifecycle_status = 'active'
      ORDER BY v.venue_id`).all();
    const cases = facts.map((fact) => {
      const payload = JSON.parse(fact.payload_json);
      const publishedUrl = payload.website_provenance?.source_url
        || payload.website_decision?.final_url || fact.fact_key;
      const expectedUrl = reviewed.get(fact.venue_id)?.review?.official_website_status === "accepted"
        ? reviewed.get(fact.venue_id).review.official_website_url : "";
      const label = expectedUrl && registrableDomain(expectedUrl) === registrableDomain(publishedUrl)
        ? "official" : "not_official";
      const policyAction = store.hasActivePublisherAttestation(fact.venue_id, publishedUrl,
        { at: "2026-09-02T00:00:00.000Z" }) ? "retain" : "reject";
      return { venue_id: fact.venue_id, name: fact.display_name, published_url: publishedUrl,
        adjudicated_url: expectedUrl || null, label, policy_action: policyAction,
        passed: label === "official" ? policyAction === "retain" : policyAction === "reject" };
    });
    const official = cases.filter((item) => item.label === "official");
    const falseCases = cases.filter((item) => item.label === "not_official");
    return { pilot, source_database_mutated: false, replay_copy: copyDbPath,
      imported_attestations: imported.accepted_reviews, publications: cases.length,
      true_publications: official.length,
      true_retained: official.filter((item) => item.policy_action === "retain").length,
      false_publications: falseCases.length,
      false_rejected: falseCases.filter((item) => item.policy_action === "reject").length,
      passed: cases.every((item) => item.passed), cases };
  } finally { store.close(); }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) result[argv[i]?.replace(/^--/, "")] = argv[i + 1];
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.copy || !args.selection || !args.pilot) {
    throw new Error("usage: node benchmark/replay-durable-publisher-ownership.mjs --db SOURCE.sqlite --copy COPY.sqlite --selection SELECTION.json --pilot NAME [--output REPORT.json]");
  }
  const result = replayDurablePublisherOwnership({ sourceDbPath: args.db, copyDbPath: args.copy,
    selectionPath: args.selection, pilot: args.pilot });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) writeFileSync(resolve(args.output), output);
  else process.stdout.write(output);
  if (!result.passed) process.exitCode = 1;
}
