import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResources } from "./evaluate-resources.mjs";

test("Session 7 publishes validated resource roles and rejects every hard negative", async () => {
  const first = await evaluateResources();
  const second = await evaluateResources();
  assert.deepEqual(first, second);
  assert.ok(first.metrics.published_resource_precision >= 0.95);
  assert.equal(first.metrics.hard_negative_publications, 0);
  assert.ok(Object.values(first.metrics.by_role).every((item) => item.precision >= 0.95));
  assert.ok(Object.values(first.metrics.by_role).every((item) => item.recall === 1));
  assert.ok(first.cases.every((item) => item.passed));
});
