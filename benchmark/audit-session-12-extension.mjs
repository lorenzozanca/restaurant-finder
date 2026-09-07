#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { collectVenueIds } from "../lib/unseen-selector.mjs";

const root = resolve(".");
const read = (path) => readFileSync(resolve(root, path));
const json = (path) => JSON.parse(read(path));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const freeze = json("benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-FREEZE.json");
const first = json(freeze.original_cohort.selection_path);
const second = json(freeze.extension_cohort.selection_path);
const queries = json(freeze.bounded_search_protocol.query_plan_path);

assert.equal(digest(read(freeze.original_cohort.selection_path)), freeze.original_cohort.selection_sha256);
assert.equal(digest(read(freeze.original_cohort.freeze_path)), freeze.original_cohort.freeze_sha256);
assert.equal(digest(read(freeze.extension_cohort.selection_path)), freeze.extension_cohort.selection_sha256);
assert.equal(digest(read(freeze.bounded_search_protocol.query_plan_path)), freeze.bounded_search_protocol.query_plan_sha256);
for (const item of [freeze.sampling_protocol.selection_wrapper, freeze.sampling_protocol.unchanged_selector,
  freeze.bounded_search_protocol.query_preparer,
  { path: freeze.combined_evaluation_protocol.evaluator_path, sha256: freeze.combined_evaluation_protocol.evaluator_sha256 },
  { path: freeze.combined_evaluation_protocol.fixture_policy_path, sha256: freeze.combined_evaluation_protocol.fixture_policy_sha256 },
  { path: freeze.combined_evaluation_protocol.registrable_domain_policy_path, sha256: freeze.combined_evaluation_protocol.registrable_domain_policy_sha256 }]) {
  assert.equal(digest(read(item.path)), item.sha256, `hash mismatch: ${item.path}`);
}

assert.equal(first.candidates.length, 500);
assert.equal(second.candidates.length, 500);
assert.equal(digest(JSON.stringify(first.candidates)), freeze.original_cohort.candidate_fingerprint_sha256);
assert.equal(digest(JSON.stringify(second.candidates)), freeze.extension_cohort.candidate_fingerprint_sha256);
const firstIds = new Set(first.candidates.map((entry) => entry.venue_id));
const secondIds = new Set(second.candidates.map((entry) => entry.venue_id));
assert.equal(firstIds.size, 500);
assert.equal(secondIds.size, 500);
assert.equal([...secondIds].filter((id) => firstIds.has(id)).length, 0);
const historical = new Set();
for (const input of second.exclusions.inputs) collectVenueIds(json(input.path), historical);
assert.equal(historical.size, 1556);
assert.equal([...secondIds].filter((id) => historical.has(id)).length, 0);
for (const regionCode of new Set(second.candidates.map((entry) => entry.region_code))) {
  assert.equal(second.candidates.filter((entry) => entry.region_code === regionCode).length, 25);
}

assert.equal(queries.queries.length, 500);
assert.equal(queries.queries_opened_at_freeze, 0);
assert.equal(queries.selection_fingerprint_sha256, freeze.extension_cohort.candidate_fingerprint_sha256);
assert.equal(digest(JSON.stringify(queries.queries)), freeze.bounded_search_protocol.query_fingerprint_sha256);
assert.ok(queries.queries.every((entry, index) => entry.sample_index === index + 1
  && entry.venue_id === second.candidates[index].venue_id && entry.query));

const originalNames = readdirSync(resolve(root, "benchmark/session-12-web")).sort()
  .filter((name) => /^locked-holdout-(?:capture-.*\.partial|adjudication-.*)\.json$/.test(name));
const originalRows = originalNames.map((name) => {
  const path = `benchmark/session-12-web/${name}`;
  return [path, digest(read(path))];
});
assert.equal(originalRows.length,
  freeze.original_cohort.preservation_snapshot.capture_and_adjudication_artifact_count);
assert.equal(digest(originalRows.map(([path, hash]) => `${path}\0${hash}`).join("\n")),
  freeze.original_cohort.preservation_snapshot.path_hash_tree_sha256);
for (const [path, expected] of [
  ["benchmark/SESSION-12-POWERED-HOLDOUT-CHECKPOINT.md", freeze.original_cohort.preservation_snapshot.checkpoint_sha256],
  ["benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-PLAN.md", freeze.original_cohort.preservation_snapshot.extension_plan_sha256],
  ["benchmark/prepare-session-12-adjudication.mjs", freeze.original_cohort.preservation_snapshot.adjudication_preparer_sha256],
]) assert.equal(digest(read(path)), expected, `preservation mismatch: ${path}`);

assert.equal(freeze.extension_cohort.queries_opened_at_freeze, 0);
assert.equal(freeze.combined_evaluation_protocol.evaluator_executions_at_freeze, 0);
process.stdout.write(`${JSON.stringify({
  stage: "A",
  status: "passed",
  cohorts: [first.candidates.length, second.candidates.length],
  unique_venues: new Set([...firstIds, ...secondIds]).size,
  historical_exclusions: historical.size,
  extension_queries_opened: 0,
  evaluator_executions: 0,
}, null, 2)}\n`);
