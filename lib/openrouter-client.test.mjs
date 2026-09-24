import assert from "node:assert/strict";
import test from "node:test";
import { BudgetExhaustedError, createOpenRouterClient, priceFromCatalog,
  readOpenRouterKey } from "./openrouter-client.mjs";

const prices = { "cheap/model": { prompt: 1e-6, completion: 2e-6, request: 0 } };

function fakeFetch(responses, requests = []) {
  return async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), { status: next.status || 200 });
  };
}

function reply(content, cost) {
  return { body: { id: "gen-1", model: "cheap/model", provider: "Test",
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, ...(cost === undefined ? {} : { cost }) } } };
}

test("reads the operator's OPENROUTER key name", () => {
  assert.equal(readOpenRouterKey({ OPENROUTER: " sk-or-test " }), "sk-or-test");
  assert.equal(readOpenRouterKey({ OPENROUTER_API_KEY: "a", OPENROUTER: "b" }), "a");
});

test("sends a no-data-collection structured request and books the reported cost", async () => {
  const requests = [];
  const client = createOpenRouterClient({ apiKey: "k", budgetUsd: 1, prices,
    fetch: fakeFetch([reply({ ok: "yes" }, 0.0012)], requests) });
  const result = await client.complete({ model: "cheap/model", schemaName: "answer",
    schema: { type: "object" }, messages: [{ role: "user", content: "hello" }], maxTokens: 50 });
  assert.deepEqual(result.json, { ok: "yes" });
  assert.equal(result.cost_usd, 0.0012);
  assert.equal(client.spentUsd(), 0.0012);
  const body = requests[0].body;
  assert.equal(body.provider.data_collection, "deny");
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.temperature, 0);
  assert.equal(body.response_format.json_schema.strict, true);
});

test("refuses a call that could cross the cap, counting prior run spend", async () => {
  let sent = 0;
  const client = createOpenRouterClient({ apiKey: "k", budgetUsd: 0.01, spentUsd: 0.0095, prices,
    fetch: async () => { sent++; return new Response("{}"); } });
  await assert.rejects(client.complete({ model: "cheap/model", maxTokens: 1_000,
    messages: [{ role: "user", content: "x".repeat(3_000) }] }), BudgetExhaustedError);
  assert.equal(sent, 0);
});

test("books the worst case when no cost is reported and retries rate limits", async () => {
  const client = createOpenRouterClient({ apiKey: "k", budgetUsd: 1, prices, sleep: async () => {},
    fetch: fakeFetch([{ status: 429, body: { error: { code: 429, message: "slow down" } } },
      reply({ ok: true })]) });
  await client.complete({ model: "cheap/model", maxTokens: 100,
    messages: [{ role: "user", content: "abc" }] });
  // 1 input token estimate + 100 completion tokens at the pinned prices.
  assert.ok(client.spentUsd() >= 1e-6 + 100 * 2e-6);
});

test("catalog prices bill reasoning at the higher completion rate", () => {
  assert.deepEqual(priceFromCatalog({ prompt: "0.000000435", completion: "0.00000087",
    internal_reasoning: "0" }), { prompt: 4.35e-7, completion: 8.7e-7, request: 0 });
});
