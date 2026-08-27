import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cacheGet, cacheSet } from "./cache.mjs";
import { createSearchCacheKey, searchDetailed } from "./search.mjs";

const request = { query: "Example", purpose: "general", limit: 5 };

test("search cache keys include provider, endpoint, purpose, locale, and location", () => {
  const one = createSearchCacheKey(request, [{ name: "one", endpointVersion: "v1" }]);
  const providerChanged = createSearchCacheKey(request, [{ name: "two", endpointVersion: "v1" }]);
  const endpointChanged = createSearchCacheKey(request, [{ name: "one", endpointVersion: "v2" }]);
  const purposeChanged = createSearchCacheKey({ ...request, purpose: "broad_discovery",
    location: { municipality: "Oderzo" } }, [{ name: "one", endpointVersion: "v1" }]);
  assert.notEqual(one, providerChanged);
  assert.notEqual(one, endpointChanged);
  assert.notEqual(one, purposeChanged);
});

test("isolated cache directories do not share entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "restaurant-search-cache-"));
  const coldA = join(root, "a");
  const coldB = join(root, "b");
  await cacheSet("same-key", { value: 1 }, { cacheDir: coldA, ttlMs: 1_000 });
  assert.deepEqual(await cacheGet("same-key", { cacheDir: coldA }), { value: 1 });
  assert.equal(await cacheGet("same-key", { cacheDir: coldB }), null);
});

test("irrelevant provider responses are not cached and cannot poison another provider", async () => {
  const stores = [];
  const irrelevant = { name: "irrelevant", endpointVersion: "v1", search: async () => ({
    provider: "irrelevant", http_status: 200, transport_ok: true, parse_ok: true,
    results: [{ title: "Wrong", url: "https://wrong.test/", snippet: "Rome" }],
  }) };
  const result = await searchDetailed({ query: '"Venue" "Oderzo"', purpose: "official_site",
    identity: { aliases: ["Venue"] }, location: { municipality: "Oderzo" } }, {
    providers: [irrelevant], cacheGetFn: async () => null,
    cacheSetFn: async (...args) => stores.push(args),
  });
  assert.equal(result.outcome, "irrelevant");
  assert.equal(stores.length, 0);
  assert.notEqual(
    createSearchCacheKey(request, [{ name: "irrelevant", endpointVersion: "v1" }]),
    createSearchCacheKey(request, [{ name: "other", endpointVersion: "v1" }]),
  );
});
