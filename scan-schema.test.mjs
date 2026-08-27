import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_SCHEMA_VERSION,
  normalizeScanDocument,
  serializeScanDocument,
  validateCurrentScanDocument,
} from "./scan-schema.mjs";

test("removes transient search snippets when serializing a scan", () => {
  const serialized = serializeScanDocument({
    source_runs: [{ results: [{ title: "Result", snippet: "Provider prose", url: "https://example.test/" }] }],
    restaurants: [{ name: "Example", nested: { snippet: "More provider prose", result_count: 1 } }],
  });
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed.source_runs[0].results[0], {
    title: "Result",
    url: "https://example.test/",
  });
  assert.deepEqual(parsed.restaurants[0].nested, { result_count: 1 });
});

test("normalizes an unversioned legacy scan without discarding fields", () => {
  const scan = normalizeScanDocument({
    location: "Oderzo",
    with_menu: 1,
    restaurants: [{ name: "Example", menu_sources: [{ url: "https://example.test/menu" }] }],
  });
  assert.equal(scan.schema_version, 1);
  assert.equal(scan.with_resources, 1);
  assert.equal(scan.restaurants[0].resources.length, 1);
});

test("requires provenance for published v2 fields and resources", () => {
  const base = {
    schema_version: CURRENT_SCHEMA_VERSION,
    source_runs: [{ source: "nominatim", status: "succeeded", result_count: 1 }],
    restaurants: [{
      name: "Example",
      provenance: { name: [{ source: "nominatim", origin: "osm_object" }] },
      resources: [],
    }],
  };
  assert.equal(validateCurrentScanDocument(base), base);
  assert.throws(
    () => validateCurrentScanDocument({ ...base, restaurants: [{ name: "Missing" }] }),
    /name is missing provenance/
  );
  assert.throws(
    () => validateCurrentScanDocument({
      ...base,
      restaurants: [{
        ...base.restaurants[0],
        resources: [{ url: "https://example.test/menu", found_via: "official_website" }],
      }],
    }),
    /resource is missing provenance/
  );
});

test("accepts the current schema and rejects unknown future schemas explicitly", () => {
  assert.equal(normalizeScanDocument({
    schema_version: CURRENT_SCHEMA_VERSION,
    restaurants: [],
  }).schema_version, CURRENT_SCHEMA_VERSION);
  assert.throws(
    () => normalizeScanDocument({ schema_version: CURRENT_SCHEMA_VERSION + 1 }),
    /newer than supported/
  );
});

test("validates a structured location without reparsing its display name", () => {
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, location: "Motta di Livenza",
    location_context: { municipality: "Motta di Livenza", province_code: "TV",
      country_code: "IT", postcodes: ["31045"] }, source_runs: [], restaurants: [] };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(() => validateCurrentScanDocument({ ...scan, location: "Motta" }), /does not match/);
});

test("accepts degraded source health with bounded useful-result counts", () => {
  const scan = {
    schema_version: CURRENT_SCHEMA_VERSION,
    source_runs: [{ source: "web_search", status: "degraded", result_count: 2,
      useful_result_count: 1, reason: "provider_outage" }],
    restaurants: [],
  };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(() => validateCurrentScanDocument({
    ...scan,
    source_runs: [{ ...scan.source_runs[0], useful_result_count: 3 }],
  }), /useful_result_count/);
});

test("validates canonical identity source records and reversible merge audit", () => {
  const provenance = {
    name: [{ source: "nominatim", origin: "osm_object" }],
    canonical_venue_id: [{ source: "identity", origin: "derived" }],
  };
  const restaurant = {
    name: "Ca' Lozzio",
    canonical_venue_id: "venue:oderzo:ca-lozzio",
    aliases: ["Ca' Lozzio", "Ca'Lozzio"],
    provenance,
    source_records: [
      { source_record_id: "nominatim:way/1", source: "nominatim", name: "Ca' Lozzio" },
      { source_record_id: "nominatim:node/2", source: "nominatim", name: "Ca'Lozzio" },
    ],
    merge_audit: [{
      status: "merged",
      left_source_record_id: "nominatim:way/1",
      right_source_record_id: "nominatim:node/2",
      evidence: [{ type: "name_exact" }, { type: "distance" }],
    }],
    resources: [],
  };
  const scan = {
    schema_version: CURRENT_SCHEMA_VERSION,
    source_runs: [],
    restaurants: [restaurant],
  };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(
    () => validateCurrentScanDocument({
      ...scan,
      restaurants: [{ ...restaurant, merge_audit: [{
        ...restaurant.merge_audit[0], right_source_record_id: "nominatim:missing",
      }] }],
    }),
    /merge audit is incomplete/
  );
});

test("accepts auditable unmatched identity pairs for review", () => {
  const restaurant = { name: "Bar Centrale", canonical_venue_id: "venue:parma:bar-centrale",
    aliases: ["Bar Centrale"], resources: [],
    provenance: { name: [{ source: "nominatim", origin: "osm_object" }],
      canonical_venue_id: [{ source: "identity", origin: "derived" }] },
    source_records: [{ source_record_id: "nominatim:node/1", source: "nominatim", name: "Bar Centrale" }],
    merge_audit: [], identity_review: [{ status: "review",
      left_source_record_id: "nominatim:node/1", right_source_record_id: "web_search:bar centrale",
      score: 50, evidence: [{ type: "name_exact" }],
      reason: "name_similarity_requires_independent_corroboration" }] };
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, source_runs: [], restaurants: [restaurant] };
  assert.equal(validateCurrentScanDocument(scan), scan);
});

test("requires one reasoned attempt record per search request", () => {
  const base = {
    schema_version: CURRENT_SCHEMA_VERSION,
    source_runs: [],
    restaurants: [],
    enrichment_run: {
      strategy: "website_first",
      crawl_requests: 1,
      crawl_cache_hits: 0,
      search_requests: 1,
      search_attempts: [{
        kind: "identity",
        reason: "known_website_no_resources",
        query: "Example Oderzo",
        result_count: 0,
      }],
    },
  };
  assert.equal(validateCurrentScanDocument(base), base);
  assert.throws(
    () => validateCurrentScanDocument({
      ...base,
      enrichment_run: { ...base.enrichment_run, search_attempts: [] },
    }),
    /search request count does not match/
  );
  assert.throws(
    () => validateCurrentScanDocument({
      ...base,
      enrichment_run: {
        ...base.enrichment_run,
        search_attempts: [{ ...base.enrichment_run.search_attempts[0], reason: "" }],
      },
    }),
    /search attempt is missing its reason/
  );
});

test("validates bounded official-site resolver terminal states", () => {
  const run = { strategy: "website_first", resolver_status: "budget_exhausted",
    resolver_stop_reason: "crawl_budget_exhausted",
    resolver_budget: { searches: 2, crawls: 1 },
    crawl_requests: 1, crawl_cache_hits: 0, search_requests: 1,
    search_attempts: [{ kind: "official_site_identity", reason: "alias_location_identity",
      query: '"Example" "Oderzo"', result_count: 2 }],
    crawl_attempts: [{ requested_url: "https://review.test/", final_url: "https://review.test/",
      outcome: "review", origin: "web_search", search_rank: 1, request_count: 1, cache_hit: false }],
    resolver_candidate_decisions: [{ url: "https://review.test/", outcome: "review", score: 50,
      reasons: ["identity_without_geography"] }] };
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, source_runs: [], restaurants: [],
    enrichment_run: run };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(() => validateCurrentScanDocument({ ...scan,
    enrichment_run: { ...run, resolver_budget: { searches: 2, crawls: 0 } } }), /crawl budget/);
  assert.throws(() => validateCurrentScanDocument({ ...scan,
    enrichment_run: { ...run, resolver_status: "review" } }), /must stop accepted or budget_exhausted/);
});

test("validates per-role resource stage metrics and their totals", () => {
  const empty = { candidates: 0, accepted: 0, review: 0, rejected: 0,
    pre_cap_dropped: 0, post_cap_dropped: 0 };
  const menu = { candidates: 3, accepted: 1, review: 0, rejected: 1,
    pre_cap_dropped: 1, post_cap_dropped: 0 };
  const run = { strategy: "website_first", crawl_requests: 0, crawl_cache_hits: 0,
    search_requests: 0, resource_site_search_requests: 1,
    resource_stage_metrics: { totals: menu, by_role: { menu } } };
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, source_runs: [], restaurants: [], enrichment_run: run };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(() => validateCurrentScanDocument({ ...scan,
    enrichment_run: { ...run, resource_stage_metrics: { totals: empty, by_role: { menu } } } }),
  /metric totals do not match/);
});

test("validates explainable official-website decisions", () => {
  const restaurant = {
    name: "Example",
    provenance: { name: [{ source: "nominatim", origin: "osm_object" }] },
    resources: [],
    website_decision: {
      status: "review",
      scores: { identity: 60, geography: 20, officialness: 55 },
      confidence: "low",
      evidence: ["name_tokens"],
    },
  };
  const scan = {
    schema_version: CURRENT_SCHEMA_VERSION,
    source_runs: [],
    restaurants: [restaurant],
  };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(
    () => validateCurrentScanDocument({
      ...scan,
      restaurants: [{
        ...restaurant,
        website_decision: {
          ...restaurant.website_decision,
          scores: { ...restaurant.website_decision.scores, identity: 101 },
        },
      }],
    }),
    /identity score must be an integer from 0 to 100/
  );
});

test("validates accepted, review, and rejected resource decisions", () => {
  const restaurant = {
    name: "Example",
    provenance: { name: [{ source: "nominatim", origin: "osm_object" }] },
    resources: [],
    resource_decisions: [{
      status: "review",
      role: "order",
      requested_url: "https://orders.test/example",
      final_url: "https://orders.test/example",
      http_status: 200,
      checked_at: "2026-08-26T12:00:00.000Z",
      evidence: ["order_evidence", "redirected_external_domain"],
    }],
  };
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, source_runs: [], restaurants: [restaurant] };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(
    () => validateCurrentScanDocument({
      ...scan,
      restaurants: [{ ...restaurant, resource_decisions: [{ ...restaurant.resource_decisions[0], evidence: [] }] }],
    }),
    /resource decision is missing validation evidence/,
  );
});

test("validates explicit last-known-good freshness and evidence-store counters", () => {
  const fact = { fact_id: 1, status: "last_known_good", freshness: "stale",
    first_seen: "2026-01-01T00:00:00.000Z", last_seen: "2026-01-01T00:00:00.000Z",
    last_checked: "2026-02-01T00:00:00.000Z", valid_until: "2026-01-31T00:00:00.000Z",
    retry_after: "2026-02-02T00:00:00.000Z", last_check_outcome: "temporarily_unreachable",
    evidence_version: 1 };
  const restaurant = { name: "Example", resources: [],
    provenance: { name: [{ source: "nominatim", origin: "osm_object" }] },
    evidence_state: { source: "sqlite_last_known_good", venue_id: "venue:oderzo:example",
      website: fact, resources: [], due_for_revalidation: true } };
  const scan = { schema_version: CURRENT_SCHEMA_VERSION, source_runs: [], restaurants: [restaurant],
    evidence_store: { schema_version: 1, evidence_version: 1, reused_venues: 1,
      stale_venues: 1, due_for_revalidation: 1 } };
  assert.equal(validateCurrentScanDocument(scan), scan);
  assert.throws(() => validateCurrentScanDocument({ ...scan,
    evidence_store: { ...scan.evidence_store, stale_venues: 2 } }), /counters are inconsistent/);
});
