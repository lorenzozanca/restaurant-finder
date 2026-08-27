import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEnrichment } from "./evaluate-enrichment.mjs";

test("Session 5 keeps benchmark links while avoiding searches for useful known sites", async () => {
  const first = await evaluateEnrichment();
  const second = await evaluateEnrichment();
  assert.deepEqual(first, second);
  assert.equal(first.metrics.link_recall, 1);
  assert.equal(first.metrics.website_first_search_requests, 0);
  assert.equal(first.metrics.search_first_baseline_requests, 4);
  assert.equal(first.metrics.search_request_reduction, 1);
  assert.ok(first.cases.every((item) => item.passed));
});
