#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateWebStress, joinWebStressEntries, validateWebAdjudicationSet,
  verifiedOwnershipPredictions } from "../lib/web-stress-fixture.mjs";

export function evaluateSession11Web({ directory, partition }) {
  if (!["development", "locked_holdout"].includes(partition)) {
    throw new Error("partition must be development or locked_holdout");
  }
  const prefix = partition.replace("_", "-");
  const names = readdirSync(resolve(directory)).sort();
  const fixturePattern = new RegExp(`^${prefix}-\\d{3}-\\d{3}\\.json$`);
  const adjudicationPattern = new RegExp(`^${prefix}-adjudication-\\d{3}-\\d{3}\\.json$`);
  const load = (pattern) => names.filter((name) => pattern.test(name))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), "utf8")));
  const fixtures = load(fixturePattern);
  const adjudications = load(adjudicationPattern);
  if (!fixtures.length || !adjudications.length) throw new Error(`missing ${partition} web artifacts`);
  const corpus = validateWebAdjudicationSet(adjudications, fixtures,
    { expectedPartition: partition });
  const entries = joinWebStressEntries(fixtures, adjudications,
    verifiedOwnershipPredictions(adjudications));
  return {
    schema_version: 1,
    partition,
    selection_fingerprint_sha256: fixtures[0].selection_fingerprint_sha256,
    prediction_policy: "publish only a candidate domain with independently verified venue ownership",
    evaluation_scope: "official-site publication gate and bounded-search discovery",
    resource_role_metrics: { status: "not_evaluated",
      reason: "minimal URL/title fixtures contain no captured resource-role predictions or adjudications" },
    corpus,
    metrics: evaluateWebStress(entries),
    artifact_sha256: Object.fromEntries(names.filter((name) => fixturePattern.test(name)
      || adjudicationPattern.test(name)).map((name) => [name,
      createHash("sha256").update(readFileSync(resolve(directory, name))).digest("hex")])),
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${argv[index] || ""}`);
    }
    result[argv[index].slice(2)] = argv[index + 1];
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.directory || !args.partition) {
    throw new Error("usage: node benchmark/evaluate-session-11-web.mjs --directory DIR --partition development|locked_holdout [--output REPORT.json]");
  }
  const report = `${JSON.stringify(evaluateSession11Web({ directory: args.directory,
    partition: args.partition }), null, 2)}\n`;
  if (args.output) writeFileSync(resolve(args.output), report);
  else process.stdout.write(report);
}
