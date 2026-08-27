import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateBenchmark } from "./evaluate.mjs";

const benchmarkPath = resolve("benchmark/v1/benchmark.json");
const baselinePath = resolve("benchmark/v1/baseline.json");

test("offline benchmark evaluation is deterministic", async () => {
  const first = await evaluateBenchmark(benchmarkPath);
  const second = await evaluateBenchmark(benchmarkPath);
  assert.deepEqual(first, second);
  assert.equal(first.metrics.unlabeled_records, 0);
});

test("checked-in baseline matches the evaluator", async () => {
  const actual = await evaluateBenchmark(benchmarkPath);
  const expected = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.deepEqual({
    benchmark_version: actual.benchmark_version,
    evaluator_version: actual.evaluator_version,
    metrics: actual.metrics,
    municipality_venue_metrics: Object.fromEntries(actual.municipalities.map((item) => [
      item.id, item.metrics.venue_admission,
    ])),
  }, expected);
});

test("Oderzo hard negatives and known good links are measured", async () => {
  const result = await evaluateBenchmark(benchmarkPath);
  const oderzo = result.municipalities.find((item) => item.id === "oderzo");
  assert.equal(oderzo.metrics.venue_admission.false_positives, 8);
  assert.ok(oderzo.errors.false_positives.every((item) =>
    ["bdueb", "cercare-vicino", "wikimedia", "milano-pocket", "roma-pop", "san-filippo-neri", "scatti-di-gusto", "trattoria-contemporanea"]
      .some((id) => item.endsWith(`/${id}`))
  ));
  assert.equal(oderzo.errors.website_errors.some((item) => item.includes("barhacca")), false);
  assert.equal(oderzo.errors.resource_errors.some((item) => item.includes("pub-gatto-nero")), false);
  assert.deepEqual(oderzo.errors.unresolved_duplicates, ["oderzo/calozzio"]);
});

test("Session 2 snapshot rejects all known false positives", async () => {
  const result = await evaluateBenchmark(resolve("benchmark/v1/session-2.json"));
  const baseline = JSON.parse(await readFile(resolve("benchmark/v1/session-2-baseline.json"), "utf8"));
  const oderzo = result.municipalities.find((item) => item.id === "oderzo");
  assert.deepEqual({
    benchmark_version: result.benchmark_version,
    evaluator_version: result.evaluator_version,
    metrics: result.metrics,
  }, baseline);
  assert.equal(result.metrics.venue_admission.precision, 1);
  assert.equal(oderzo.metrics.venue_admission.precision, 1);
  assert.equal(oderzo.metrics.venue_admission.false_positives, 0);
  assert.equal(oderzo.metrics.venue_admission.false_negatives, 3);
});

test("Session 4 snapshot resolves the labelled duplicate through source records", async () => {
  const result = await evaluateBenchmark(resolve("benchmark/v1/session-4.json"));
  const oderzo = result.municipalities.find((item) => item.id === "oderzo");
  assert.equal(result.metrics.duplicates.resolved, 1);
  assert.equal(result.metrics.duplicates.unresolved, 0);
  assert.deepEqual(oderzo.errors.unresolved_duplicates, []);
  assert.equal(result.metrics.venue_admission.precision, 1);
});
