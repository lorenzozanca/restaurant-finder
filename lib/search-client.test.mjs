import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSearchClient } from "./search-client.mjs";
import { searchDetailed } from "./search.mjs";
import { createReplaySearchProvider } from "../sources/search/replay.mjs";

const captured = JSON.parse(await readFile("benchmark/v2/search-replay/captured.json", "utf8"));

for (const fixture of captured.cases) {
  test(`classifies captured replay: ${fixture.id}`, async () => {
    const provider = createReplaySearchProvider([fixture]);
    const response = await createSearchClient({ providers: [provider] }).search(fixture.request);
    assert.equal(response.outcome, fixture.expected_outcome);
    assert.equal(response.attempts.length, 1);
    assert.equal(response.attempts[0].provider, fixture.attempt.provider);
    assert.equal(response.attempts[0].raw_count, fixture.attempt.results.length);
    assert.equal(response.results.length, fixture.attempt.results.length);
    for (const field of ["provider", "http_status", "transport_ok", "parse_ok", "raw_count", "relevant_count", "duration_ms", "rate_headers", "reason"]) {
      assert.ok(Object.hasOwn(response.attempts[0], field), `missing attempt metadata: ${field}`);
    }
  });
}

test("preserves rate headers and every fallback attempt", async () => {
  const providers = [
    { name: "limited", search: async () => ({ provider: "limited", http_status: 429, transport_ok: false, parse_ok: false, rate_headers: { "x-ratelimit-reset": "2" }, results: [] }) },
    { name: "good", search: async () => ({ provider: "good", http_status: 200, transport_ok: true, parse_ok: true, duration_ms: 7, results: [{ title: "Barhacca Oderzo", url: "https://barhacca.it/", snippet: "Ristorante 31046" }] }) },
  ];
  const response = await createSearchClient({ providers }).search({
    query: '"Barhacca" "Oderzo"', purpose: "official_site",
    location: { municipality: "Oderzo", postcodes: ["31046"] }, identity: { aliases: ["Barhacca"] },
  });
  assert.equal(response.outcome, "relevant");
  assert.equal(response.attempts.length, 2);
  assert.equal(response.attempts[0].http_status, 429);
  assert.equal(response.attempts[0].rate_headers["x-ratelimit-reset"], "2");
  assert.equal(response.attempts[1].duration_ms, 7);
});

test("replays empty, timeout, parser-change, and domain mismatch without network", async () => {
  const scenarios = [
    [{ name: "empty", search: async () => ({ provider: "empty", http_status: 200, transport_ok: true, parse_ok: true, results: [] }) }, "empty"],
    [{ name: "timeout", search: async () => { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; } }, "provider_failed"],
    [{ name: "changed", search: async () => ({ provider: "changed", http_status: 200, transport_ok: true, parse_ok: false, results: [] }) }, "provider_failed"],
    [{ name: "limited", search: async () => ({ provider: "limited", http_status: 429, transport_ok: false, parse_ok: false, rate_headers: { "x-ratelimit-reset": "3" }, results: [] }) }, "rate_limited"],
    [{ name: "mismatch", search: async () => ({ provider: "mismatch", http_status: 200, transport_ok: true, parse_ok: true, results: [{ title: "Help", url: "https://example.com/", snippet: "" }] }) }, "irrelevant"],
  ];
  for (const [provider, expected] of scenarios) {
    const response = await createSearchClient({ providers: [provider] }).search({ query: "site:paginegialle.it Oderzo", purpose: "domain_constrained", required_domain: "paginegialle.it" });
    assert.equal(response.outcome, expected);
    assert.equal(response.attempts.length, 1);
  }
});

test("compatibility adapter returns arrays while exposing cached response health", async () => {
  const fixture = captured.cases.find((item) => item.id === "bing-domain-mismatch-paginegialle");
  const response = await searchDetailed(fixture.request, { cacheGetFn: async () => fixture.attempt.results });
  assert.equal(response.outcome, "irrelevant");
  assert.equal(response.cache.status, "hit");
  assert.equal(response.results.length, 10);
  assert.equal(response.attempts[0].reason, "legacy_cache_replay");
});
