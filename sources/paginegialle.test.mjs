import test from "node:test";
import assert from "node:assert/strict";
import { discover } from "./paginegialle.mjs";
import { runSource } from "../source-run.mjs";

test("zero matching-domain results produce a degraded source run", async () => {
  const run = await runSource("paginegialle", discover, "Oderzo", {
    searchDetailedFn: async () => ({ outcome: "irrelevant", results: [] }),
  });
  assert.equal(run.manifest.status, "degraded");
  assert.equal(run.manifest.useful_result_count, 0);
  assert.deepEqual(run.manifest.search_outcomes, ["irrelevant", "irrelevant", "irrelevant"]);
});
