#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { evaluateWebStress, joinWebStressEntries, validateWebAdjudicationSet } from "./lib/web-stress-fixture.mjs";
import { registrableDomain } from "./lib/publisher-ownership.mjs";

// Scores one LLM ownership-review run against agent-reviewed labels. Development
// only: a development report never authorizes publication (PROCESS.md step 3).
export function evaluateLlmReview(options) {
  const partition = required(options.partition, "partition");
  const runId = required(options.runId, "run-id");
  const directories = (options.fixtureDirectories || []).map((directory) => resolve(directory));
  if (!directories.length) throw new Error("at least one fixture directory is required");
  const groups = directories.map((directory) => loadGroup(directory, partition));
  const store = new EvidenceStore(resolve(required(options.dbPath, "db")));
  try {
    const outcomes = store.listLlmReviewOutcomes(runId);
    const calls = store.db.prepare("SELECT * FROM llm_review_calls WHERE run_id = ? ORDER BY call_id")
      .all(runId);
    const byVenue = Map.groupBy(outcomes, (row) => row.venue_id);
    const predictions = [...byVenue].map(([venueId, rows]) => ({ venue_id: venueId,
      prediction: { official_website_url: predictionForVenue(rows) } }));
    const evaluated = groups.flatMap((group) => joinWebStressEntries(group.fixtures,
      group.adjudications, predictions));
    const labels = new Map(evaluated.map((entry) => [entry.venue_id, entry]));
    const reviewFor = (venueId, url) => labels.get(venueId)?.adjudication?.domain_reviews
      ?.find((item) => item.registrable_domain === registrableDomain(url));
    const falsePublications = evaluated.filter((entry) => entry.prediction.official_website_url)
      .filter((entry) => {
        const review = reviewFor(entry.venue_id, entry.prediction.official_website_url);
        return !review || review.ownership_status === "rejected"
          || (review.ownership_status === "verified" && registrableDomain(entry.prediction.official_website_url)
            !== registrableDomain(entry.adjudication.official_website_url));
      }).map((entry) => ({ venue_id: entry.venue_id, name: entry.name,
        predicted_url: entry.prediction.official_website_url,
        label: reviewFor(entry.venue_id, entry.prediction.official_website_url) || "unreviewed" }));
    const candidateRows = outcomes.map((row) => ({ ...row,
      label_status: reviewFor(row.venue_id, row.final_url)?.ownership_status
        || reviewFor(row.venue_id, row.candidate_url)?.ownership_status || "unreviewed" }));
    const falseRejections = candidateRows.filter((row) => row.outcome === "rejected"
      && row.label_status === "verified").map(detail);
    const missedAccepts = candidateRows.filter((row) => row.outcome === "ambiguous"
      && row.label_status === "verified").map(detail);
    const acceptedWrong = candidateRows.filter((row) => row.outcome === "accepted"
      && row.label_status !== "verified").map(detail);
    const costByStage = Object.fromEntries(["triage", "verifier"].map((stage) => {
      const stageCalls = calls.filter((call) => call.stage === stage);
      return [stage, { calls: stageCalls.length, invalid_outputs: stageCalls.filter((call) => !call.valid_output).length,
        cost_usd: round(stageCalls.reduce((sum, call) => sum + call.cost_usd, 0)),
        prompt_tokens: stageCalls.reduce((sum, call) => sum + call.prompt_tokens, 0),
        completion_tokens: stageCalls.reduce((sum, call) => sum + call.completion_tokens, 0),
        models: [...new Set(stageCalls.map((call) => call.model))] }];
    }));
    const totalCost = calls.reduce((sum, call) => sum + call.cost_usd, 0);
    return {
      schema_version: 1,
      evaluation_id: `${partition}-${runId}`,
      evaluated_at: new Date().toISOString(),
      partition, run_id: runId,
      status: "development_evidence_not_publication",
      prompt_versions: [...new Set(outcomes.map((row) => row.prompt_version))],
      reviewed_candidates: outcomes.length,
      reviewed_venues: byVenue.size,
      outcome_counts: Object.fromEntries(["accepted", "rejected", "ambiguous"].map((outcome) =>
        [outcome, outcomes.filter((row) => row.outcome === outcome).length])),
      venue_metrics: evaluateWebStress(evaluated),
      false_publications: falsePublications,
      candidate_audit: {
        accepted_not_labelled_verified: acceptedWrong,
        false_rejections: falseRejections,
        verified_left_ambiguous: missedAccepts,
      },
      cost: { total_usd: round(totalCost), by_stage: costByStage,
        per_reviewed_candidate_usd: outcomes.length ? round(totalCost / outcomes.length) : null },
    };
  } finally { store.close(); }
}

function predictionForVenue(rows) {
  const accepted = rows.filter((row) => row.outcome === "accepted");
  const domains = new Set(accepted.map((row) => registrableDomain(row.final_url)).filter(Boolean));
  if (domains.size !== 1) return null;
  return accepted.map((row) => row.final_url).sort()[0];
}

function detail(row) {
  return { venue_id: row.venue_id, candidate_url: row.candidate_url, final_url: row.final_url,
    outcome: row.outcome, stage: row.stage, publisher_kind: row.publisher_kind, reasons: row.reasons,
    label_status: row.label_status, verifier_reason: row.review?.verifier?.reason || null,
    triage_reason: row.review?.triage?.reason || null };
}

function loadGroup(directory, partition) {
  const fixturePattern = partition === "development"
    ? /^development-\d{3}-\d{3}\.json$/ : /^locked-holdout-\d{3}-\d{3}\.json$/;
  const adjudicationPattern = partition === "development"
    ? /^development-adjudication-\d{3}-\d{3}\.json$/ : /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/;
  const names = readdirSync(directory).sort();
  const fixtures = names.filter((name) => fixturePattern.test(name)).map((name) => loadJson(resolve(directory, name)));
  const adjudications = names.filter((name) => adjudicationPattern.test(name))
    .map((name) => loadJson(resolve(directory, name)));
  if (!fixtures.length || !adjudications.length) throw new Error(`incomplete fixture group: ${directory}`);
  validateWebAdjudicationSet(adjudications, fixtures, { expectedPartition: partition });
  return { fixtures, adjudications };
}

function loadJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function round(value) { return Math.round(value * 1e6) / 1e6; }
function required(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} is required`); return text; }

function parseArgs(argv) {
  const result = { fixtureDirectories: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--fixture-dir") result.fixtureDirectories.push(argv[++index]);
    else if (flag === "--partition") result.partition = argv[++index];
    else if (flag === "--db") result.dbPath = argv[++index];
    else if (flag === "--run-id") result.runId = argv[++index];
    else if (flag === "--output") result.output = argv[++index];
    else throw new Error(`unknown argument: ${flag}`);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const report = evaluateLlmReview(args);
  if (args.output) writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
  const { venue_metrics: metrics } = report;
  process.stdout.write(`${JSON.stringify({ output: args.output ? resolve(args.output) : null,
    outcome_counts: report.outcome_counts, publications: metrics.publications,
    true_publications: metrics.true_publications, false_publications: metrics.false_publications,
    official_sites: metrics.official_sites, recall: metrics.official_site_recall,
    false_rejections: report.candidate_audit.false_rejections.length,
    verified_left_ambiguous: report.candidate_audit.verified_left_ambiguous.length,
    cost: report.cost }, null, 2)}\n`);
}
