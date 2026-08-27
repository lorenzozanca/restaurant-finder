import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStructuredRecall } from "./evaluate-structured-recall.mjs";

test("structured source adds the frozen web-only case without broad searches", async () => {
  const report = await evaluateStructuredRecall();
  const osm = report.combinations.find((item) => item.name === "osm");
  const combined = report.combinations.find((item) => item.name === "osm+overture");
  assert.equal(osm.truth_venues_found, 42);
  assert.equal(combined.truth_venues_found, 43);
  assert.ok(combined.truth_ids.includes("barhacca"));
  assert.deepEqual(combined.wrong_category_or_unlabelled_candidates, []);
  assert.ok(combined.duplicate_truth_ids.includes("ragazzon"));
  assert.deepEqual(report.gap_discovery.retained_template_ids, ["postcode_restaurant_menu"]);
  assert.equal(report.brave_places.status, "not_run");
});
