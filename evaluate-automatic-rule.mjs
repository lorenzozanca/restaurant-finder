#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { automaticPredictionForVenue, AUTOMATIC_FIRST_PARTY_RULE_VERSION } from "./lib/automatic-first-party-rule.mjs";
import { evaluateWebStress, joinWebStressEntries, validateWebAdjudicationSet } from "./lib/web-stress-fixture.mjs";
import { registrableDomain } from "./lib/publisher-ownership.mjs";

export function evaluateAutomaticRule(options) {
  const partition = required(options.partition, "partition");
  const directories = (options.fixtureDirectories || []).map((directory) => resolve(directory));
  if (!directories.length) throw new Error("at least one fixture directory is required");
  const groups = directories.map((directory) => loadGroup(directory, partition));
  const entries = groups.flatMap((group) => joinWebStressEntries(group.fixtures, group.adjudications));
  const store = new EvidenceStore(resolve(required(options.dbPath, "db")));
  try {
    const assessments = store.db.prepare("SELECT * FROM candidate_assessments ORDER BY assessment_id").all()
      .map(publicAssessment);
    const expectedKeys = new Set(entries.flatMap((entry) => entry.candidates
      .map((candidate) => key(entry.venue_id, candidate.url))));
    const actualKeys = new Set(assessments.map((item) => key(item.venue_id, item.candidate_url)));
    if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((item) => !actualKeys.has(item))) {
      throw new Error(`assessment coverage mismatch: expected ${expectedKeys.size}, found ${actualKeys.size}`);
    }
    if (options.expectedVenues !== undefined && entries.length !== Number(options.expectedVenues)) {
      throw new Error(`expected ${options.expectedVenues} venues, found ${entries.length}`);
    }
    if (options.expectedCandidates !== undefined && expectedKeys.size !== Number(options.expectedCandidates)) {
      throw new Error(`expected ${options.expectedCandidates} candidates, found ${expectedKeys.size}`);
    }
    const byVenue = Map.groupBy(assessments, (item) => item.venue_id);
    const predictions = entries.map((entry) => ({ venue_id: entry.venue_id, prediction: {
      official_website_url: automaticPredictionForVenue(byVenue.get(entry.venue_id) || []),
    } }));
    const evaluated = groups.flatMap((group) => joinWebStressEntries(group.fixtures,
      group.adjudications, predictions));
    const metrics = evaluateWebStress(evaluated);
    const falsePublications = evaluated.filter((entry) => entry.prediction.official_website_url)
      .filter((entry) => {
        const domain = registrableDomain(entry.prediction.official_website_url);
        const review = entry.adjudication.domain_reviews.find((item) => item.registrable_domain === domain);
        return !review || review.ownership_status === "rejected"
          || (review.ownership_status === "verified"
            && domain !== registrableDomain(entry.adjudication.official_website_url));
      }).map((entry) => {
        const domain = registrableDomain(entry.prediction.official_website_url);
        const review = entry.adjudication.domain_reviews.find((item) => item.registrable_domain === domain);
        return { venue_id: entry.venue_id, name: entry.name,
          predicted_url: entry.prediction.official_website_url,
          publisher_class: review?.publisher_class || "unreviewed",
          ownership_status: review?.ownership_status || "unreviewed" };
      });
    const acceptance = {
      minimum_conclusive_publications: 73,
      maximum_false_publications: 0,
      minimum_wilson_lower_bound: 0.95,
      conclusive_publications_met: metrics.conclusive_publications >= 73,
      flawless_publications_met: metrics.false_publications === 0,
      wilson_lower_bound_met: (metrics.official_site_precision_wilson_95.lower || 0) >= 0.95,
    };
    acceptance.passed = acceptance.conclusive_publications_met
      && acceptance.flawless_publications_met && acceptance.wilson_lower_bound_met;
    return {
      schema_version: 1,
      evaluation_id: `${partition}-automatic-first-party-v1`,
      evaluated_at: new Date().toISOString(), partition,
      rule_version: AUTOMATIC_FIRST_PARTY_RULE_VERSION,
      rule_sha256: digest(readFileSync(resolve("lib/automatic-first-party-rule.mjs"))),
      assessed_candidates: assessments.length,
      assessment_counts: store.candidateAssessmentCounts(),
      metrics, acceptance, false_publications: falsePublications,
      input_artifacts_sha256: Object.fromEntries(groups.flatMap((group) => group.files)
        .map((path) => [path, digest(readFileSync(path))])),
    };
  } finally { store.close(); }
}

function loadGroup(directory, partition) {
  const fixturePattern = partition === "development"
    ? /^development-\d{3}-\d{3}\.json$/ : /^locked-holdout-\d{3}-\d{3}\.json$/;
  const adjudicationPattern = partition === "development"
    ? /^development-adjudication-\d{3}-\d{3}\.json$/
    : /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/;
  const names = readdirSync(directory).sort();
  const fixturePaths = names.filter((name) => fixturePattern.test(name)).map((name) => resolve(directory, name));
  const adjudicationPaths = names.filter((name) => adjudicationPattern.test(name)).map((name) => resolve(directory, name));
  if (!fixturePaths.length || !adjudicationPaths.length) throw new Error(`incomplete fixture group: ${directory}`);
  const fixtures = fixturePaths.map(loadJson);
  const adjudications = adjudicationPaths.map(loadJson);
  validateWebAdjudicationSet(adjudications, fixtures, { expectedPartition: partition });
  return { fixtures, adjudications, files: [...fixturePaths, ...adjudicationPaths] };
}

function publicAssessment(row) {
  return { venue_id: row.venue_id, candidate_url: row.candidate_url, final_url: row.final_url,
    assessment_state: row.assessment_state, crawl_outcome: row.crawl_outcome,
    scores: { identity: row.identity_score, geography: row.geography_score,
      officialness: row.officialness_score }, evidence: loadJsonText(row.evidence_json) };
}
function loadJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function loadJsonText(value) { try { return JSON.parse(value); } catch { return []; } }
function canonicalUrl(value) { try { return new URL(value).href; } catch { return String(value || ""); } }
function key(venueId, url) { return `${venueId}\n${canonicalUrl(url)}`; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function required(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} is required`); return text; }

function parseArgs(argv) {
  const result = { fixtureDirectories: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--fixture-dir") result.fixtureDirectories.push(argv[++index]);
    else if (flag === "--partition") result.partition = argv[++index];
    else if (flag === "--db") result.dbPath = argv[++index];
    else if (flag === "--expected-venues") result.expectedVenues = argv[++index];
    else if (flag === "--expected-candidates") result.expectedCandidates = argv[++index];
    else if (flag === "--output") result.output = argv[++index];
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!result.output) throw new Error("output is required");
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const report = evaluateAutomaticRule(args);
  writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output: resolve(args.output), metrics: report.metrics,
    acceptance: report.acceptance }, null, 2)}\n`);
}
