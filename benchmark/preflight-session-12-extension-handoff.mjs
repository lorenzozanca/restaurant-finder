#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { validateWebAdjudicationSet } from "../lib/web-stress-fixture.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(resolve(path));
const json = (path) => JSON.parse(read(path));
const freeze = json("benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-FREEZE.json");
const firstSelection = json(freeze.original_cohort.selection_path);
const secondSelection = json(freeze.extension_cohort.selection_path);
const finalCaptureCheckpoint = json("benchmark/SESSION-12-EXTENSION-CAPTURE-CHECKPOINT-500.json");
const finalAdjudicationCheckpoint = json("benchmark/SESSION-12-EXTENSION-ADJUDICATION-CHECKPOINT-500.json");

function assertHash(path, expected) {
  assert.equal(digest(read(path)), expected, `hash mismatch: ${path}`);
}
function names(directory, pattern) {
  return readdirSync(resolve(directory)).filter((name) => pattern.test(name)).sort();
}
function loadDocuments(directory, fileNames) {
  return fileNames.map((name) => json(`${directory}/${name}`));
}
function projectTitles(documents) {
  return documents.map((document) => ({ ...document,
    fixture_set: document.fixture_set.replace(/-partial$/, ""),
    entries: document.entries.map((entry) => ({ ...entry,
      candidates: entry.candidates.map((candidate) => ({ ...candidate,
        title: [...candidate.title].slice(0, 200).join(""),
      })),
    })),
  }));
}
function validateCohort({ directory, selection, fingerprint, capturePattern, expectedCaptureCount,
  expectedAdjudicationCount }) {
  const captureNames = names(directory, capturePattern);
  const adjudicationNames = names(directory,
    /^locked-holdout-adjudication-\d{3}-\d{3}\.json$/);
  assert.equal(captureNames.length, expectedCaptureCount, `capture file count: ${directory}`);
  assert.equal(adjudicationNames.length, expectedAdjudicationCount,
    `adjudication file count: ${directory}`);
  const rawFixtures = loadDocuments(directory, captureNames);
  const fixtures = projectTitles(rawFixtures);
  const adjudications = loadDocuments(directory, adjudicationNames);
  const fixtureEntries = fixtures.flatMap((document) => document.entries);
  const adjudicationEntries = adjudications.flatMap((document) => document.entries);
  const expectedIds = selection.candidates.map((entry) => entry.venue_id);
  assert.deepEqual(fixtureEntries.map((entry) => entry.venue_id), expectedIds,
    `capture order: ${directory}`);
  assert.deepEqual(adjudicationEntries.map((entry) => entry.venue_id), expectedIds,
    `adjudication order: ${directory}`);
  assert.ok([...fixtures, ...adjudications].every((document) =>
    document.selection_fingerprint_sha256 === fingerprint), `fingerprint: ${directory}`);
  const corpus = validateWebAdjudicationSet(adjudications, fixtures,
    { expectedPartition: "locked_holdout" });
  return { captureNames, adjudicationNames, corpus,
    projected_titles: rawFixtures.flatMap((document) => document.entries)
      .flatMap((entry) => entry.candidates).filter((candidate) => [...candidate.title].length > 200).length };
}

assertHash(freeze.original_cohort.selection_path, freeze.original_cohort.selection_sha256);
assertHash(freeze.original_cohort.freeze_path, freeze.original_cohort.freeze_sha256);
assertHash(freeze.extension_cohort.selection_path, freeze.extension_cohort.selection_sha256);
assertHash(freeze.bounded_search_protocol.query_plan_path,
  freeze.bounded_search_protocol.query_plan_sha256);
for (const artifact of [freeze.sampling_protocol.selection_wrapper,
  freeze.sampling_protocol.unchanged_selector, freeze.bounded_search_protocol.query_preparer,
  { path: freeze.combined_evaluation_protocol.evaluator_path,
    sha256: freeze.combined_evaluation_protocol.evaluator_sha256 },
  { path: freeze.combined_evaluation_protocol.fixture_policy_path,
    sha256: freeze.combined_evaluation_protocol.fixture_policy_sha256 },
  { path: freeze.combined_evaluation_protocol.registrable_domain_policy_path,
    sha256: freeze.combined_evaluation_protocol.registrable_domain_policy_sha256 }]) {
  assertHash(artifact.path, artifact.sha256);
}
for (const [path, expected] of [
  ["benchmark/SESSION-12-POWERED-HOLDOUT-CHECKPOINT.md",
    freeze.original_cohort.preservation_snapshot.checkpoint_sha256],
  ["benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-PLAN.md",
    freeze.original_cohort.preservation_snapshot.extension_plan_sha256],
  ["benchmark/prepare-session-12-adjudication.mjs",
    freeze.original_cohort.preservation_snapshot.adjudication_preparer_sha256],
]) assertHash(path, expected);

const originalNames = names("benchmark/session-12-web",
  /^locked-holdout-(?:capture-.*\.partial|adjudication-.*)\.json$/);
const originalRows = originalNames.map((name) => {
  const path = `benchmark/session-12-web/${name}`;
  return [path, digest(read(path))];
});
assert.equal(originalRows.length,
  freeze.original_cohort.preservation_snapshot.capture_and_adjudication_artifact_count);
assert.equal(digest(originalRows.map(([path, hash]) => `${path}\0${hash}`).join("\n")),
  freeze.original_cohort.preservation_snapshot.path_hash_tree_sha256,
  "original capture/adjudication tree changed");

assert.equal(firstSelection.candidates.length, 500);
assert.equal(secondSelection.candidates.length, 500);
assert.equal(digest(JSON.stringify(firstSelection.candidates)),
  freeze.original_cohort.candidate_fingerprint_sha256);
assert.equal(digest(JSON.stringify(secondSelection.candidates)),
  freeze.extension_cohort.candidate_fingerprint_sha256);
const firstIds = new Set(firstSelection.candidates.map((entry) => entry.venue_id));
const secondIds = new Set(secondSelection.candidates.map((entry) => entry.venue_id));
assert.equal(firstIds.size, 500);
assert.equal(secondIds.size, 500);
assert.equal([...secondIds].filter((id) => firstIds.has(id)).length, 0);

const queries = json(freeze.bounded_search_protocol.query_plan_path);
assert.equal(queries.queries.length, 500);
assert.equal(digest(JSON.stringify(queries.queries)),
  freeze.bounded_search_protocol.query_fingerprint_sha256);
assert.ok(queries.queries.every((entry, index) => entry.sample_index === index + 1
  && entry.venue_id === secondSelection.candidates[index].venue_id));

for (const [name, expected] of Object.entries(finalCaptureCheckpoint.capture_sha256)) {
  assertHash(`benchmark/session-12-extension-web/${name}`, expected);
}
for (const [name, expected] of Object.entries(finalAdjudicationCheckpoint.adjudication_sha256)) {
  assertHash(`benchmark/session-12-extension-web/${name}`, expected);
}
assert.equal(finalCaptureCheckpoint.completed_queries_reopened, 0);
assert.equal(finalCaptureCheckpoint.evaluator_runs, 0);
assert.equal(finalAdjudicationCheckpoint.search_queries_issued_or_reopened_during_adjudication, 0);
assert.equal(finalAdjudicationCheckpoint.evaluator_runs, 0);

const first = validateCohort({ directory: "benchmark/session-12-web",
  selection: firstSelection, fingerprint: freeze.original_cohort.candidate_fingerprint_sha256,
  capturePattern: /^locked-holdout-capture-\d{3}-\d{3}\.partial\.json$/,
  expectedCaptureCount: 34, expectedAdjudicationCount: 6 });
const second = validateCohort({ directory: "benchmark/session-12-extension-web",
  selection: secondSelection, fingerprint: freeze.extension_cohort.candidate_fingerprint_sha256,
  capturePattern: /^locked-holdout-capture-\d{3}-\d{3}\.partial\.json$/,
  expectedCaptureCount: 5, expectedAdjudicationCount: 5 });

process.stdout.write(`${JSON.stringify({
  stage: "D",
  status: "passed_no_evaluator",
  unique_non_overlapping_venues: new Set([...firstIds, ...secondIds]).size,
  original_artifacts_preserved: true,
  cohorts: [
    { fingerprint: freeze.original_cohort.candidate_fingerprint_sha256,
      captures: first.captureNames.length, adjudications: first.adjudicationNames.length,
      corpus: first.corpus, projected_overlong_titles: first.projected_titles },
    { fingerprint: freeze.extension_cohort.candidate_fingerprint_sha256,
      captures: second.captureNames.length, adjudications: second.adjudicationNames.length,
      corpus: second.corpus, projected_overlong_titles: second.projected_titles },
  ],
  searches_reopened: 0,
  evaluator_runs: 0,
}, null, 2)}\n`);
