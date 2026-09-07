#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateWebStress,
  joinWebStressEntries,
  validateWebAdjudicationSet,
  verifiedOwnershipPredictions,
} from "../lib/web-stress-fixture.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const loadJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));

function cohort({ directory, selectionPath, expectedFingerprint }) {
  const selection = loadJson(selectionPath);
  if (selection.candidates?.length !== 500
      || selection.candidate_fingerprint_sha256 !== expectedFingerprint
      || digest(JSON.stringify(selection.candidates)) !== expectedFingerprint) {
    throw new Error(`invalid selection or fingerprint: ${selectionPath}`);
  }
  const names = readdirSync(resolve(directory)).sort();
  const fixturePattern = /^locked-holdout-\d{3}-\d{3}\.json$/;
  const adjudicationPattern = /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/;
  const fixtureNames = names.filter((name) => fixturePattern.test(name));
  const adjudicationNames = names.filter((name) => adjudicationPattern.test(name));
  if (!fixtureNames.length || !adjudicationNames.length
      || names.some((name) => /(?:partial|\.tmp\.|~$)/.test(name))) {
    throw new Error(`incomplete, partial, or stale artifact set: ${directory}`);
  }
  const fixtures = fixtureNames.map((name) => loadJson(resolve(directory, name)));
  const adjudications = adjudicationNames.map((name) => loadJson(resolve(directory, name)));
  for (const document of [...fixtures, ...adjudications]) {
    if (document.selection_fingerprint_sha256 !== expectedFingerprint) {
      throw new Error(`mixed cohort fingerprint in ${directory}`);
    }
  }
  const fixtureEntries = fixtures.flatMap((document) => document.entries);
  const adjudicationEntries = adjudications.flatMap((document) => document.entries);
  const expectedIds = selection.candidates.map((entry) => entry.venue_id);
  for (const [label, entries] of [["fixture", fixtureEntries], ["adjudication", adjudicationEntries]]) {
    if (entries.length !== 500 || entries.some((entry, index) => entry.venue_id !== expectedIds[index])) {
      throw new Error(`${label} order or exact coverage mismatch in ${directory}`);
    }
  }
  const corpus = validateWebAdjudicationSet(adjudications, fixtures,
    { expectedPartition: "locked_holdout" });
  const entries = joinWebStressEntries(fixtures, adjudications,
    verifiedOwnershipPredictions(adjudications));
  return {
    fingerprint: expectedFingerprint,
    entries,
    corpus,
    artifact_sha256: Object.fromEntries([...fixtureNames, ...adjudicationNames]
      .map((name) => [name, digest(readFileSync(resolve(directory, name)))])),
  };
}

export function evaluateSession12Combined(options) {
  const first = cohort({ directory: options.firstDirectory,
    selectionPath: options.firstSelection,
    expectedFingerprint: options.firstFingerprint });
  const second = cohort({ directory: options.secondDirectory,
    selectionPath: options.secondSelection,
    expectedFingerprint: options.secondFingerprint });
  const firstIds = new Set(first.entries.map((entry) => entry.venue_id));
  if (second.entries.some((entry) => firstIds.has(entry.venue_id))) {
    throw new Error("cross-cohort venue overlap");
  }
  const metrics = evaluateWebStress([...first.entries, ...second.entries]);
  const acceptance = {
    minimum_conclusive_publications: 73,
    minimum_wilson_lower_bound: 0.95,
    conclusive_publications_met: metrics.conclusive_publications >= 73,
    flawless_publications_met: metrics.false_publications === 0,
    wilson_lower_bound_met: metrics.official_site_precision_wilson_95.lower >= 0.95,
  };
  acceptance.passed = acceptance.conclusive_publications_met
    && acceptance.flawless_publications_met && acceptance.wilson_lower_bound_met;
  return {
    schema_version: 1,
    evaluation_id: "session-12-powered-holdout-combined-v1",
    evaluated_venues: 1000,
    cohort_fingerprints_sha256: [first.fingerprint, second.fingerprint],
    prediction_policy: "publish only a candidate domain with independently verified venue ownership",
    resource_role_metrics: { status: "not_evaluated",
      reason: "minimal URL/title fixtures contain no resource-role predictions or adjudications" },
    cohorts: [
      { selection_fingerprint_sha256: first.fingerprint, corpus: first.corpus,
        artifact_sha256: first.artifact_sha256 },
      { selection_fingerprint_sha256: second.fingerprint, corpus: second.corpus,
        artifact_sha256: second.artifact_sha256 },
    ],
    pooled_metrics: metrics,
    acceptance,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${argv[index] || ""}`);
    }
    result[argv[index].slice(2).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())] = argv[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const required = ["firstDirectory", "secondDirectory", "firstSelection", "secondSelection",
    "firstFingerprint", "secondFingerprint", "output"];
  if (required.some((key) => !args[key])) throw new Error(`missing required argument: ${required.find((key) => !args[key])}`);
  const report = evaluateSession12Combined(args);
  writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}
