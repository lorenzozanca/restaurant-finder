#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const selectionPath = resolve("benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-SELECTION.json");
const outputPath = resolve("benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-QUERIES.json");
const selection = JSON.parse(await readFile(selectionPath, "utf8"));

const chainDomains = new Map([
  ["burger king", "burgerking.it"], ["kfc", "kfc.it"],
  ["la piadineria", "lapiadineria.com"], ["mcdonald's", "mcdonalds.it"],
  ["mcdonalds", "mcdonalds.it"], ["old wild west", "oldwildwest.it"],
  ["poke house", "poke-house.com"], ["roadhouse", "roadhouse.it"],
  ["rossopomodoro", "rossopomodoro.it"], ["signorvino", "signorvino.com"],
  ["starbucks", "starbucks.it"], ["subway", "subway.com"],
]);

function quoted(value) {
  return `"${String(value).replaceAll('"', "").trim()}"`;
}

function street(address, municipality) {
  const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => part !== municipality && !/^\d{5}\b/.test(part)) || "";
}

function queryFor(candidate) {
  const normalizedName = String(candidate.name || "").toLocaleLowerCase("it-IT").trim();
  const chain = [...chainDomains].find(([name]) => normalizedName.includes(name));
  const road = street(candidate.address, candidate.municipality);
  if (chain && road) {
    return { template: "official_chain_branch", query: `site:${chain[1]} ${quoted(road)} ${quoted(candidate.municipality)}` };
  }
  const generic = normalizedName.length < 12 || /^(?:bar|cafe|caffè|gelateria|pizzeria|ristorante|trattoria)\b/.test(normalizedName);
  if (generic && road) {
    return { template: "exact_name_locality_street", query: `${quoted(candidate.name)} ${quoted(candidate.municipality)} ${quoted(road)}` };
  }
  return { template: "exact_name_locality", query: `${quoted(candidate.name)} ${quoted(candidate.municipality)}` };
}

const queries = selection.candidates.map((candidate) => ({
  sample_index: candidate.sample_index,
  venue_id: candidate.venue_id,
  ...queryFor(candidate),
}));
const fingerprint = createHash("sha256").update(JSON.stringify(queries)).digest("hex");
const document = {
  schema_version: 1,
  query_plan_id: "session-12-powered-holdout-extension-queries-v1",
  frozen_before_search_outcomes: true,
  selection_fingerprint_sha256: selection.candidate_fingerprint_sha256,
  search_provider_interface: "Codex integrated web search",
  locale: "it-IT",
  country_assumption: "Italy",
  bounded_result_limit: 5,
  retention_policy: "Retain at most the first five query-relevant organic results in provider order; store only normalized HTTP(S) URL and title, with title projected to its first 200 Unicode code points.",
  url_normalization_policy: "lib/web-stress-fixture.mjs normalizeCandidateUrl: remove fragments and tracking parameters, sort remaining query parameters, lowercase hostname, preserve HTTP(S).",
  failure_policy: "A completed response, including zero relevant results, is final and is never reopened. A provider/tool failure before a result is returned permits one retry of the identical query; after two failed attempts record an empty candidate list and the failure in the checkpoint.",
  queries_opened_at_freeze: 0,
  query_fingerprint_sha256: fingerprint,
  queries,
};
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output: outputPath, queries: queries.length, fingerprint }, null, 2)}\n`);
