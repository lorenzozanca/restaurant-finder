import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledSearchProvider } from "./provider-scheduler.mjs";
import { createSearchClient } from "./search-client.mjs";

test("one-RPS scheduling spaces concurrent first attempts and owned retries", async () => {
  let clock = 0;
  const starts = [];
  const calls = new Map();
  let active = 0;
  let maxActive = 0;
  const provider = {
    name: "fixture",
    async search(request) {
      starts.push(clock);
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      const count = (calls.get(request.query) || 0) + 1;
      calls.set(request.query, count);
      if (request.query === "retry" && count === 1) {
        return { provider: "fixture", http_status: 429, transport_ok: false, parse_ok: false,
          rate_headers: { "x-ratelimit-reset": "2" }, results: [] };
      }
      return { provider: "fixture", http_status: 200, transport_ok: true, parse_ok: true,
        results: [{ title: request.query, url: "https://example.test/", snippet: "" }] };
    },
  };
  const scheduled = createScheduledSearchProvider(provider, {
    requestsPerSecond: 1, maxConcurrency: 1, maxRetries: 1,
    now: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0,
  });
  const [retried, other] = await Promise.all([
    scheduled.search({ query: "retry" }),
    scheduled.search({ query: "other" }),
  ]);

  assert.equal(retried.provider_attempts.length, 2);
  assert.equal(other.provider_attempts.length, 1);
  assert.equal(maxActive, 1);
  assert.equal(starts.length, 3);
  for (let index = 1; index < starts.length; index++) {
    assert.ok(starts[index] - starts[index - 1] >= 1_000,
      `launches ${index - 1}/${index} were only ${starts[index] - starts[index - 1]}ms apart`);
  }
});

test("search response preserves retry attempts and provider fallback", async () => {
  let clock = 0;
  let calls = 0;
  const limited = createScheduledSearchProvider({
    name: "limited",
    async search() {
      calls++;
      return { provider: "limited", http_status: 429, transport_ok: false,
        parse_ok: false, rate_headers: { "retry-after": "1" }, results: [] };
    },
  }, { minIntervalMs: 1_000, maxRetries: 1, now: () => clock,
    sleep: async (ms) => { clock += ms; }, random: () => 0 });
  const good = { name: "good", search: async () => ({ provider: "good", http_status: 200,
    transport_ok: true, parse_ok: true,
    results: [{ title: "Barhacca Oderzo", url: "https://barhacca.it/", snippet: "31046" }] }) };
  const response = await createSearchClient({ providers: [limited, good], now: () => clock }).search({
    query: '"Barhacca" "Oderzo"', purpose: "official_site",
    identity: { aliases: ["Barhacca"] }, location: { municipality: "Oderzo", postcodes: ["31046"] },
  });
  assert.equal(calls, 2);
  assert.equal(response.outcome, "relevant");
  assert.deepEqual(response.attempts.map((attempt) => attempt.provider), ["limited", "limited", "good"]);
});

test("circuit breaker and provider attempt budget fail closed", async () => {
  let clock = 0;
  let calls = 0;
  const scheduled = createScheduledSearchProvider({ name: "down", async search() {
    calls++;
    return { provider: "down", http_status: 503, transport_ok: true, parse_ok: false, results: [] };
  } }, { minIntervalMs: 0, maxRetries: 0, maxAttempts: 2, failureThreshold: 2,
    circuitCooldownMs: 5_000, now: () => clock, sleep: async (ms) => { clock += ms; } });

  assert.equal((await scheduled.search({})).reason, undefined);
  assert.equal((await scheduled.search({})).reason, undefined);
  assert.equal((await scheduled.search({})).reason, "circuit_open");
  clock += 5_000;
  assert.equal((await scheduled.search({})).reason, "budget_exhausted");
  assert.equal(calls, 2);
});
