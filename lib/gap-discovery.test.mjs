import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPostcodeGapQueries, evaluateGapQueryReplay } from "./gap-discovery.mjs";

test("postcode gap queries require labelled residual gaps and remain bounded", () => {
  const location = { municipality: "Oderzo", province_code: "TV", postcodes: ["31046"] };
  assert.deepEqual(buildPostcodeGapQueries(location), []);
  const queries = buildPostcodeGapQueries(location, {
    residualGaps: [{ id: "gellius", categories: ["restaurant"] }], maxQueries: 10,
  });
  assert.ok(queries.length <= 4);
  assert.deepEqual(queries.map((item) => item.id),
    ["postcode_restaurant_menu", "municipality_province_restaurant_menu"]);
  assert.ok(queries.every((item) => item.query.includes("Oderzo") || item.query.includes("31046")));
});

test("keeps only query templates with marginal truth-set value", async () => {
  const replay = JSON.parse(await readFile("benchmark/v2/gap-query-replay.json", "utf8"));
  const report = evaluateGapQueryReplay(replay.templates, replay.already_found_truth_ids);
  assert.equal(report.queries_run, 3);
  assert.deepEqual(report.retained_template_ids, ["postcode_restaurant_menu"]);
  assert.deepEqual(report.templates[0].marginal_truth_ids, ["gellius"]);
  assert.equal(report.templates[1].keep, false);
  assert.equal(report.templates[2].keep, false);
});
