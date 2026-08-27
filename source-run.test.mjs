import test from "node:test";
import assert from "node:assert/strict";
import { disabledSourceRun, runSource, sourceResult } from "./source-run.mjs";

test("records successful zero-result sources separately from failures", async () => {
  const success = await runSource("empty", async () => []);
  const failure = await runSource("broken", async () => { throw new Error("provider down"); });
  assert.equal(success.manifest.status, "succeeded");
  assert.equal(success.manifest.useful_result_count, 0);
  assert.equal(success.manifest.result_count, 0);
  assert.equal(failure.manifest.status, "failed");
  assert.match(failure.manifest.error, /provider down/);
  assert.deepEqual(failure.items, []);
});

test("records degraded sources and useful-result counts", async () => {
  const run = await runSource("search", async () => sourceResult([], {
    status: "degraded", useful_result_count: 0, reason: "provider_outage",
    search_outcomes: ["provider_failed"],
  }));
  assert.equal(run.manifest.status, "degraded");
  assert.equal(run.manifest.result_count, 0);
  assert.equal(run.manifest.useful_result_count, 0);
  assert.equal(run.manifest.reason, "provider_outage");
});

test("preserves structured import and per-query yield reports", async () => {
  const query_yield = [{ template_id: "postcode_restaurant_menu", query: "31046 menu",
    outcome: "relevant", result_count: 2, accepted_candidate_count: 1,
    marginal_candidate_count: 1 }];
  const import_report = { input_records: 3, accepted_records: 1 };
  const run = await runSource("fixture", async () => sourceResult([{ name: "Example" }], {
    query_yield, import_report,
  }));
  assert.deepEqual(run.manifest.query_yield, query_yield);
  assert.deepEqual(run.manifest.import_report, import_report);
});

test("records disabled sources without pretending they were attempted", () => {
  assert.deepEqual(disabledSourceRun("optional").manifest, {
    source: "optional", status: "disabled", result_count: 0,
  });
});
