import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWebsites } from "./evaluate-websites.mjs";

test("Session 6 website thresholds pass the versioned hard-negative fixture", async () => {
  const first = await evaluateWebsites();
  const second = await evaluateWebsites();
  assert.deepEqual(first, second);
  assert.equal(first.metrics.official_website_precision, 1);
  assert.equal(first.metrics.official_website_recall, 1);
  assert.ok(first.metrics.high_confidence_precision >= first.metrics.medium_confidence_precision);
  assert.ok(first.cases.every((item) => item.passed));
});
