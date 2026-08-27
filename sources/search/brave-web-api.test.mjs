import test from "node:test";
import assert from "node:assert/strict";
import { createBraveWebApiProvider } from "./brave-web-api.mjs";
import { createDefaultSearchProviders } from "./default-providers.mjs";

test("Brave JSON adapter preserves rate headers and parses structured results", async () => {
  let requested;
  const provider = createBraveWebApiProvider({ apiKey: "fixture-key", fetch: async (url, options) => {
    requested = { url: String(url), options };
    return {
      ok: true, status: 200,
      headers: { get: (key) => key === "x-ratelimit-reset" ? "1" : null },
      json: async () => ({ web: { results: [
        { title: "Barhacca", url: "https://www.barhacca.it/", description: "Oderzo" },
      ] } }),
    };
  } });
  const result = await provider.search({ query: "Barhacca Oderzo", limit: 10,
    country: "IT", locale: "it-IT" });
  assert.match(requested.url, /api\.search\.brave\.com/);
  assert.equal(requested.options.headers["X-Subscription-Token"], "fixture-key");
  assert.equal(result.parse_ok, true);
  assert.equal(result.results[0].url, "https://www.barhacca.it/");
  assert.equal(result.rate_headers["x-ratelimit-reset"], "1");
});

test("production defaults do not include the scraped legacy provider", () => {
  const providers = createDefaultSearchProviders({
    brave: { apiKey: "fixture" }, scheduler: { minIntervalMs: 0, maxRetries: 0 },
  });
  assert.deepEqual(providers.map((provider) => provider.name), ["brave_web_api"]);
});

test("legacy HTML search is available only as explicit diagnostic mode", () => {
  const providers = createDefaultSearchProviders({ diagnostic: true, diagnosticEngine: "bing",
    scheduler: { minIntervalMs: 0, maxRetries: 0 } });
  assert.deepEqual(providers.map((provider) => provider.name), ["legacy_search_script"]);
  assert.match(providers[0].endpointVersion, /diagnostic-html:bing/);
});
