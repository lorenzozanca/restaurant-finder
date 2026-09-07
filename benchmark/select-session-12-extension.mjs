#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runPoweredHoldoutSelection } from "../select-powered-holdout.mjs";

const output = resolve("benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-SELECTION.json");
const result = await runPoweredHoldoutSelection({
  db: "data/istat/2026-01-01/derived/italy-import.sqlite",
  inventory: "benchmark/ITALY-OFFLINE-INVENTORY-2026-08-28.json",
  benchmarkDir: "benchmark",
  output,
});

const document = JSON.parse(await readFile(output, "utf8"));
document.selection_id = "session-12-national-powered-holdout-extension-v1";
document.generated_at = "2026-09-07T12:00:00.000Z";
document.extension_of = {
  selection_id: "session-12-national-powered-holdout-v1",
  selection_fingerprint_sha256:
    "09d36070bdb62e5c64eaa9eada9ca0c240b4deafcfabef091d3ff2eba6645b48",
};
document.selection_configuration.method =
  "Deterministic next cohort from the unchanged powered-holdout selector after excluding the first Session 12 cohort and every venue ID in the original benchmark lineage; 25 untouched queued venues per region, alternating known/missing source-website targets, with unchanged balancing rules.";
document.power_preregistration = {
  basis: "Combined planning rule fixed before any search on the extension selection",
  pooled_fixed_sample_size: 1000,
  minimum_flawless_conclusive_publications: 73,
  caveat: "The fixed pooled threshold is an acceptance criterion; no result-dependent extension or exclusion is allowed.",
};
document.evaluation_preregistration = {
  policy: "publish only a candidate domain with independently verified venue ownership",
  tuning_policy: "no policy or evaluator changes after the extension freeze; evaluate the two separately fingerprinted cohorts exactly once after complete capture and adjudication",
  official_site_precision_target: 0.95,
  interval: "two-sided 95% Wilson score interval",
  minimum_conclusive_publications: 73,
  pooled_scope: "all conclusive publications across both fixed 500-venue cohorts",
  acceptance: "at least 73 conclusive publications, zero false publications, and official-site precision Wilson lower bound >= 0.95",
  resource_role_metrics: "not evaluated by minimal URL/title fixtures",
};
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ...result, output, selection_id: document.selection_id }, null, 2)}\n`);
