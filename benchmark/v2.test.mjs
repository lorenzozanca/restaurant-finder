import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateBenchmark } from "./evaluate.mjs";

const truthPath = "benchmark/v2/oderzo-truth.json";
const benchmarkPath = "benchmark/v2/benchmark.json";

test("v2 truth set labels every row in the frozen Oderzo benchmark scans", async () => {
  const truth = JSON.parse(await readFile(truthPath, "utf8"));
  const ids = new Set(truth.venues.flatMap((venue) => [venue.osm_id, ...(venue.osm_ids || [])]).filter(Boolean));
  const names = new Set([
    ...truth.venues.flatMap((venue) => [venue.name, ...(venue.aliases || []), venue.selector?.name]),
    ...truth.hard_negatives.map((item) => item.name),
  ].filter(Boolean).map(normalize));
  const scans = [
    "benchmark/v1/scans/oderzo.json",
    "benchmark/v2/scans/oderzo-2026-08-26.json",
  ];
  for (const scanPath of scans) {
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const unlabelled = scan.restaurants.filter((row) => !(row.osm_id && ids.has(row.osm_id)) && !names.has(normalize(row.name)));
    assert.deepEqual(unlabelled.map((row) => row.name), [], `${scanPath} has unlabelled rows`);
  }
  assert.equal(truth.venues.length, 75);
  assert.equal(truth.hard_negatives.length, 8);
  assert.deepEqual(truth.closed_or_unknown, []);
});

test("v2 freezes Barhacca and Al Giardinetto as current positives", async () => {
  const truth = JSON.parse(await readFile(truthPath, "utf8"));
  const barhacca = truth.venues.find((item) => item.id === "barhacca");
  const giardinetto = truth.venues.find((item) => item.id === "giardinetto");
  assert.equal(barhacca.status, "current");
  assert.deepEqual(barhacca.official_websites, ["https://www.barhacca.it/"]);
  assert.equal(giardinetto.status, "current");
  assert.ok(giardinetto.aliases.includes("Al Giardinetto"));
  assert.equal(giardinetto.resources[0].role, "menu");
});

test("August 26 snapshot fails the documented v2 recall and role gates", async () => {
  const result = await evaluateBenchmark(benchmarkPath);
  assert.equal(result.evaluator_version, 2);
  assert.equal(result.metrics.unlabeled_records, 0);
  assert.equal(result.metrics.venue_admission.recall, 0.56);
  assert.equal(result.metrics.web_only_venue_recall, 0);
  assert.equal(result.metrics.official_website.recall, 0.12);
  assert.equal(result.metrics.resource_role.recall, 0.1351);
  assert.equal(result.errors.false_negatives.length, 33);
  assert.ok(result.errors.false_negatives.includes("oderzo/barhacca"));
  assert.ok(result.errors.false_negatives.includes("oderzo/gellius"));
  assert.ok(result.errors.false_negatives.includes("oderzo/pub-gatto-nero"));
  assert.ok(result.errors.website_errors.some((item) => item.includes("giardinetto")));
  assert.equal(result.metrics.request_cost.web_search_requests, 120);
});

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
