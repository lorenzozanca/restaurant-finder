import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { evaluateSession11Web } from "./evaluate-session-11-web.mjs";

test("evaluates the Session 11 development publication gate offline", () => {
  const report = evaluateSession11Web({
    directory: fileURLToPath(new URL("./session-11-web/", import.meta.url)),
    partition: "development",
  });
  assert.equal(report.corpus.venues, 200);
  assert.equal(report.metrics.reviewed, 200);
  assert.equal(report.metrics.true_publications, 29);
  assert.equal(report.metrics.false_publications, 0);
  assert.equal(report.metrics.passes_non_vacuity, true);
  assert.equal(report.metrics.passes_precision_target, false);
  assert.equal(report.resource_role_metrics.status, "not_evaluated");
  assert.equal(Object.keys(report.artifact_sha256).length, 16);
});
