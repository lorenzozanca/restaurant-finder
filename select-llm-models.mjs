#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/lib.mjs"; // applies the connect-race fix to this process's fetch
import { readOpenRouterKey } from "./lib/openrouter-client.mjs";

// Shortlists OpenRouter models for the ownership reviewer. Benchmarks only nominate
// candidates: a model is adopted only after a capped development run (PROCESS.md).
// Artificial Analysis data requires attribution: https://artificialanalysis.ai/

const TYPICAL = { triage: { input: 4_500, output: 300 }, verifier: { input: 4_500, output: 1_500 } };

export function shortlistModels(openRouterModels, analysisModels = [], options = {}) {
  const minContext = options.minContext || 32_000;
  const scores = new Map(analysisModels.flatMap((model) => [normalizeSlug(model.slug),
    normalizeSlug(model.name)].map((slugKey) => [slugKey, model])));
  return openRouterModels
    .filter((model) => (model.supported_parameters || []).includes("structured_outputs"))
    .filter((model) => (model.architecture?.input_modalities || ["text"]).includes("text"))
    .filter((model) => Number(model.context_length) >= minContext)
    // Routers such as openrouter/auto have variable (-1) prices and cannot be pinned.
    .filter((model) => Number(model.pricing?.prompt) >= 0 && Number(model.pricing?.completion) >= 0)
    .map((model) => {
      const prompt = Number(model.pricing?.prompt) || 0;
      const completion = Math.max(Number(model.pricing?.completion) || 0,
        Number(model.pricing?.internal_reasoning) || 0);
      const analysis = scores.get(normalizeSlug(model.id.split("/").pop()))
        || scores.get(normalizeSlug(model.name));
      const perThousand = (stage) => 1_000 * (TYPICAL[stage].input * prompt + TYPICAL[stage].output * completion);
      return {
        id: model.id, name: model.name, free: prompt === 0 && completion === 0,
        context_length: model.context_length,
        usd_per_million_input: round(prompt * 1e6), usd_per_million_output: round(completion * 1e6),
        usd_per_1000_triage_reviews: round(perThousand("triage")),
        usd_per_1000_verifier_reviews: round(perThousand("verifier")),
        aa_intelligence_index: analysis?.evaluations?.artificial_analysis_intelligence_index ?? null,
        aa_slug: analysis?.slug || null,
      };
    })
    .sort((left, right) => (right.aa_intelligence_index ?? -1) - (left.aa_intelligence_index ?? -1)
      || left.usd_per_1000_verifier_reviews - right.usd_per_1000_verifier_reviews);
}

export function normalizeSlug(value) {
  return String(value || "").toLowerCase().replace(/:free$/, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// A zero-cost check that a free model is routable under data_collection "deny".
async function probe(apiKey, model) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 20, temperature: 0,
      messages: [{ role: "user", content: "Reply with the JSON {\"ok\":true}" }],
      response_format: { type: "json_schema", json_schema: { name: "probe", strict: true, schema: {
        type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"],
        additionalProperties: false } } },
      provider: { data_collection: "deny", require_parameters: true } }),
    signal: AbortSignal.timeout(60_000),
  }).catch((error) => ({ ok: false, status: 0, json: async () => ({ error: { message: error.name } }) }));
  const payload = await response.json().catch(() => ({}));
  return response.ok && !payload.error ? "routable" : `unavailable: ${payload.error?.code || response.status} `
    + String(payload.error?.message || "").slice(0, 120);
}

async function main(argv) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const probeFree = argv.includes("--probe-free");
  const top = Number(argv[argv.indexOf("--top") + 1]) || 25;
  const catalog = await (await fetch("https://openrouter.ai/api/v1/models")).json();
  let analysis = [];
  const analysisKey = String(process.env.ARTIFICIAL_ANALYSIS_API_KEY || "").trim();
  if (analysisKey) {
    const response = await fetch("https://artificialanalysis.ai/api/v2/data/llms/models",
      { headers: { "x-api-key": analysisKey } });
    if (!response.ok) throw new Error(`Artificial Analysis HTTP ${response.status}`);
    analysis = (await response.json()).data || [];
  }
  const models = shortlistModels(catalog.data || [], analysis);
  if (probeFree) {
    const apiKey = readOpenRouterKey();
    if (!apiKey) throw new Error("--probe-free needs OPENROUTER in .env");
    for (const model of models.filter((item) => item.free)) model.no_data_collection = await probe(apiKey, model.id);
  }
  const report = { generated_at: new Date().toISOString(),
    sources: { openrouter_models: (catalog.data || []).length, artificial_analysis_models: analysis.length,
      attribution: analysis.length ? "Benchmark data: Artificial Analysis, https://artificialanalysis.ai/" : null },
    note: analysisKey ? null : "Set ARTIFICIAL_ANALYSIS_API_KEY in .env to rank by the AA intelligence index.",
    models };
  mkdirSync("data/llm-review", { recursive: true });
  const output = resolve(`data/llm-review/model-shortlist-${report.generated_at.slice(0, 10)}.json`);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const rows = [...models.filter((item) => item.free), ...models.filter((item) => !item.free).slice(0, top)];
  for (const item of rows) {
    process.stdout.write(`${item.free ? "FREE" : "paid"}  AA=${item.aa_intelligence_index ?? "-"}  `
      + `$${item.usd_per_1000_verifier_reviews}/1k verifier  ${item.id}`
      + `${item.no_data_collection ? `  [${item.no_data_collection}]` : ""}\n`);
  }
  process.stdout.write(`${models.length} structured-output models; full list: ${output}\n`);
  if (report.sources.attribution) process.stdout.write(`${report.sources.attribution}\n`);
  else process.stdout.write(`${report.note}\n`);
}

function round(value) { return Math.round(value * 1e4) / 1e4; }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`select-llm-models: ${error.message}`);
    process.exitCode = 1;
  });
}
