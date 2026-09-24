#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Runs the operator-chosen labelling agent (opencode, PROCESS.md step 3.3) one packet
// at a time under an explicit USD cap. Spend is measured from the OpenRouter key's
// usage before and after each packet; the run stops before a packet that could cross
// the cap, and on the first label file that fails validation.

const argv = process.argv.slice(2);
const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const cap = Number(arg("--budget-usd", NaN));
if (!(cap > 0)) throw new Error("--budget-usd is required");
const model = arg("--model", "openrouter/deepseek/deepseek-v4-pro");
if (/mimo/i.test(model)) throw new Error("the reviewer model family cannot label its own holdout");
const only = arg("--packet", null);
const holdout = resolve("benchmark/llm-review-holdout-v1");
const logDir = resolve("data/holdout-labelling");
const ledger = join(logDir, "opencode-spend.jsonl");
const key = JSON.parse(readFileSync(join(homedir(), ".local/share/opencode/auth.json"), "utf8")).openrouter?.key;
if (!key) throw new Error("opencode has no OpenRouter key");

async function keyUsage() {
  await new Promise((done) => setTimeout(done, 20_000)); // let OpenRouter book the last calls
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  return Number((await response.json()).data.usage);
}

const prior = existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
let spent = prior.reduce((sum, row) => sum + row.cost_usd, 0);
let largest = Math.max(0, ...prior.map((row) => row.cost_usd));
for (const name of readdirSync(join(holdout, "labelling")).sort().filter((file) => /^packet-\d{3}-\d{3}\.json$/.test(file))) {
  const range = name.slice(7, 14);
  if (only && range !== only) continue;
  const output = `locked-holdout-adjudication-${range}.json`;
  const validate = () => spawnSync("node", ["validate-holdout-labels.mjs", "--file", output], { encoding: "utf8" });
  if (existsSync(join(holdout, output)) && validate().status === 0) { console.log(`${range}: already labelled`); continue; }
  if (spent + Math.max(largest, 1) > cap) { console.log(`${range}: stopped, spent $${spent.toFixed(2)} of $${cap} cap`); break; }
  const prompt = [
    "You are an independent labeller for a locked evaluation holdout in this repository.",
    `Follow benchmark/llm-review-holdout-v1/LABELLING-INSTRUCTIONS.md exactly for packet benchmark/llm-review-holdout-v1/labelling/${name}.`,
    `Use the prefetched excerpts in data/holdout-labelling/pages-${range}.json and check the live web for failed pages or inconclusive excerpts.`,
    "Read no other repository file. Never open data/llm-review/. Do not run git.",
    `Use "reviewer": "${model} via opencode, operator-run holdout labelling" and timestamps from \`date -u +%Y-%m-%dT%H:%M:%S.000Z\`.`,
    `Write benchmark/llm-review-holdout-v1/${output} with all 48 entries (write it early and update it as you go),`,
    `then run \`node validate-holdout-labels.mjs --file ${output}\` and fix every error until it passes.`,
  ].join("\n");
  const before = await keyUsage();
  const started = Date.now();
  const run = spawnSync("opencode", ["run", "-m", model, prompt], { encoding: "utf8", timeout: 90 * 60_000,
    maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(logDir, `opencode-${range}.log`), `${run.stdout || ""}\n${run.stderr || ""}`);
  const cost = (await keyUsage()) - before;
  spent += cost;
  largest = Math.max(largest, cost);
  const check = validate();
  const row = { packet: range, model, cost_usd: Number(cost.toFixed(4)), minutes: Math.round((Date.now() - started) / 60_000),
    exit: run.status, valid: check.status === 0, at: new Date().toISOString() };
  appendFileSync(ledger, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
  if (!row.valid) { console.log(`${range}: labels invalid, stopping\n${(check.stderr || "").slice(-600)}`); break; }
}
console.log(`total opencode spend: $${spent.toFixed(2)} of $${cap}`);
