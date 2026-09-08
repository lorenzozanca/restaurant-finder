import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficialSiteQueries, resolveOfficialSite } from "./official-site-resolver.mjs";

const location = { municipality: "Oderzo", province_code: "TV", country_code: "IT",
  postcodes: ["31046"] };

function dependencies(overrides = {}) {
  return {
    classifyWebsite: (url) => url.includes("directory.test") ? "directory" : "official",
    canonicalUrl: (url) => url,
    scoreSearchCandidate: (candidate) => ({ score: candidate.rank_score || 50 }),
    scoreWebsite: (candidate) => {
      const outcome = candidate.crawl?.identity_outcome || "review";
      return { url: candidate.crawl?.final_url || candidate.url, outcome,
        score: candidate.rank_score || 50, confidence: outcome === "accepted" ? "high" : "low",
        scores: { identity: 70, geography: outcome === "accepted" ? 70 : 0, officialness: 60 },
        reasons: [outcome] };
    },
    ...overrides,
  };
}

test("Al Giardinetto continues past a wrong hotel, directory, and review candidate", async () => {
  const crawled = [];
  const results = [
    { url: "https://wrong-hotel.test/", rank_score: 90 },
    { url: "https://directory.test/barhacca", rank_score: 100 },
    { url: "https://review.test/", rank_score: 80 },
    { url: "https://algiardinetto-oderzo.test/", rank_score: 70 },
  ];
  const result = await resolveOfficialSite({
    restaurant: { name: "Al Giardinetto", aliases: ["Giardinetto"] }, location,
    search: async () => results,
    crawl: async (url) => {
      crawled.push(url);
      return { final_url: url, request_count: 1, resources: [],
        identity_outcome: url.includes("algiardinetto-oderzo.test") ? "accepted"
          : url.includes("review.test") ? "review" : "rejected" };
    },
    ...dependencies(),
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.accepted_candidate.url, "https://algiardinetto-oderzo.test/");
  assert.deepEqual(crawled, ["https://wrong-hotel.test/", "https://review.test/",
    "https://algiardinetto-oderzo.test/"]);
  assert.equal(result.search_requests, 1);
  assert.equal(result.crawl_candidates, 3);
  assert.ok(!crawled.some((url) => url.includes("directory.test")));
});

test("stops only at configured budget exhaustion when no site is accepted", async () => {
  const result = await resolveOfficialSite({
    restaurant: { name: "Al Giardinetto", aliases: ["Al Giardinetto", "Giardinetto"] }, location,
    search: async () => [{ url: "https://review.test/", rank_score: 90 },
      { url: "https://second.test/", rank_score: 80 }],
    crawl: async (url) => ({ final_url: url, request_count: 1, identity_outcome: "review", resources: [] }),
    budget: { searches: 2, crawls: 1 },
    ...dependencies(),
  });
  assert.equal(result.status, "budget_exhausted");
  assert.equal(result.stop_reason, "crawl_budget_exhausted");
  assert.equal(result.crawl_candidates, 1);
  assert.ok(result.search_requests <= 2);
});

test("crawl-only abstention is not mislabeled as exhausted search", async () => {
  const result = await resolveOfficialSite({
    restaurant: { name: "Attested", website: "https://review.test/" }, location,
    search: async () => { throw new Error("crawl-only resolution must not search"); },
    crawl: async (url) => ({ final_url: url, request_count: 1,
      identity_outcome: "review", resources: [] }),
    budget: { searches: 0, crawls: 3 },
    ...dependencies(),
  });
  assert.equal(result.status, "budget_exhausted");
  assert.equal(result.stop_reason, "crawl_only_candidates_not_accepted");
  assert.equal(result.search_requests, 0);
});

test("uses one search by default to control unresolved-venue cost", async () => {
  const result = await resolveOfficialSite({
    restaurant: { name: "Unresolved" }, location,
    search: async () => [], crawl: async () => ({}), ...dependencies(),
  });
  assert.equal(result.search_requests, 1);
  assert.equal(result.budget.searches, 1);
});

test("provider failure stops resolution and cannot become a successful no-result", async () => {
  let searches = 0;
  const result = await resolveOfficialSite({
    restaurant: { name: "Unavailable" }, location,
    search: async () => {
      searches++;
      return { outcome: "provider_failed", provider: "brave_web_api", results: [], attempts: [{
        provider: "brave_web_api", transport_ok: false, parse_ok: false,
        reason: "transport_error",
      }] };
    },
    crawl: async () => ({}),
    budget: { searches: 2, crawls: 3 },
    ...dependencies(),
  });
  assert.equal(searches, 1);
  assert.equal(result.status, "provider_unavailable");
  assert.equal(result.stop_reason, "search_provider_unavailable");
});

test("query planning uses phone, aliases, address, municipality, and postcode in evidence order", () => {
  const queries = buildOfficialSiteQueries({ name: "Al Giardinetto", aliases: ["Giardinetto"],
    phone: "+39 0422 123456", address: "Via Spinè 28, Oderzo" }, location);
  assert.equal(queries[0].reason, "exact_phone");
  assert.equal(queries[0].query, '"0422123456" "Oderzo"');
  assert.ok(queries.some((item) => item.query === '"Al Giardinetto" "Oderzo" "31046"'));
  assert.ok(queries.some((item) => item.query === '"Giardinetto" "Oderzo" "31046"'));
});

test("a third search requires a recorded escalation reason", async () => {
  const base = { restaurant: { name: "Fixture" }, location, search: async () => [],
    crawl: async () => ({}), ...dependencies() };
  await assert.rejects(() => resolveOfficialSite({ ...base, budget: { searches: 3, crawls: 3 } }),
    /budget_escalation_reason/);
  const result = await resolveOfficialSite({ ...base,
    budget: { searches: 3, crawls: 3, budget_escalation_reason: "labelled_high_confidence_venue" } });
  assert.equal(result.budget.searches, 3);
  assert.equal(result.budget.budget_escalation_reason, "labelled_high_confidence_venue");
});

test("crawls attested ownership websites before source websites and search", async () => {
  const crawled = [];
  const result = await resolveOfficialSite({
    restaurant: { name: "Venue", website: "https://source.test/" }, location,
    search: async () => { throw new Error("attested accept must not search"); },
    crawl: async (url) => {
      crawled.push(url);
      return { final_url: url, request_count: 1, resources: [],
        identity_outcome: url.includes("attested.test") ? "accepted" : "rejected" };
    },
    budget: { searches: 0, crawls: 3 },
    attestedWebsites: ["https://attested.test/", "https://attested.test/"],
    ...dependencies(),
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.accepted_candidate.url, "https://attested.test/");
  assert.equal(result.accepted_candidate.origin, "attested_ownership");
  assert.deepEqual(crawled, ["https://attested.test/"]);
  assert.equal(result.search_requests, 0);
});

test("falls back to the source website when the attested crawl is rejected", async () => {
  const crawled = [];
  const result = await resolveOfficialSite({
    restaurant: { name: "Venue", website: "https://source.test/" }, location,
    search: async () => [],
    crawl: async (url) => {
      crawled.push(url);
      return { final_url: url, request_count: 1, resources: [],
        identity_outcome: url.includes("source.test") ? "accepted" : "rejected" };
    },
    budget: { searches: 1, crawls: 3 },
    attestedWebsites: ["https://stale-attested.test/"],
    ...dependencies(),
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.accepted_candidate.origin, "source_provided");
  assert.deepEqual(crawled, ["https://stale-attested.test/", "https://source.test/"]);
});
