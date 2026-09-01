import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { EvidenceStore, EVIDENCE_SCHEMA_VERSION } from "./evidence-store.mjs";

const DAY = 86_400_000;

test("transient provider outage preserves an accepted site and exposes stale audit state", async (t) => {
  const fixture = await storeFixture(t);
  const venue = venueFixture();
  fixture.store.recordEnrichment(venue, acceptedEnrichment("https://barhacca.example/"), {
    checkedAt: "2026-01-01T00:00:00.000Z", municipality: "Oderzo",
  });

  fixture.store.recordCheckOutcome(venue, {
    kind: "website", outcome: "temporarily_unreachable",
    checkedAt: "2026-01-02T00:00:00.000Z", retryAfter: "2026-01-03T00:00:00.000Z",
    evidence: ["fixture_provider_503"],
  }, { municipality: "Oderzo" });

  const current = fixture.store.findReusableEvidence(venue, {
    at: "2026-01-02T12:00:00.000Z", municipality: "Oderzo",
  });
  assert.equal(current.website, "https://barhacca.example/");
  assert.equal(current.evidence_state.website.freshness, "current");
  assert.equal(current.evidence_state.website.last_check_outcome, "temporarily_unreachable");

  const stale = fixture.store.findReusableEvidence(venue, {
    at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + 31 * DAY), municipality: "Oderzo",
  });
  assert.equal(stale.website, "https://barhacca.example/");
  assert.equal(stale.evidence_state.website.freshness, "stale");
  assert.equal(stale.due_for_revalidation, true);
});

test("website timeout cannot erase last-known-good evidence", async (t) => {
  const fixture = await storeFixture(t);
  const venue = venueFixture();
  fixture.store.recordEnrichment(venue, acceptedEnrichment("https://barhacca.example/"), {
    checkedAt: "2026-02-01T00:00:00.000Z", municipality: "Oderzo",
  });

  fixture.store.recordEnrichment(venue, {
    resources: [], resource_decisions: [],
    enrichment_run: {
      resolver_status: "budget_exhausted", resolver_stop_reason: "crawl_budget_exhausted",
      search_attempts: [],
      crawl_attempts: [{ requested_url: "https://barhacca.example/", outcome: "rejected" }],
    },
  }, { checkedAt: "2026-02-02T00:00:00.000Z", municipality: "Oderzo" });

  const reused = fixture.store.findReusableEvidence(venue, {
    at: "2026-02-02T00:01:00.000Z", municipality: "Oderzo",
  });
  assert.equal(reused.website, "https://barhacca.example/");
  assert.equal(reused.evidence_state.website.last_check_outcome, "temporarily_unreachable");
  assert.equal(fixture.store.auditFacts(venue)[0].lifecycle_status, "active");
});

test("renamed venue reuses facts through a stable source record and records the new alias", async (t) => {
  const fixture = await storeFixture(t);
  const original = venueFixture({ name: "Giardinetto", aliases: ["Giardinetto"],
    canonical_venue_id: "venue:oderzo:giardinetto" });
  fixture.store.recordEnrichment(original, acceptedEnrichment("https://giardinetto.example/"), {
    checkedAt: "2026-03-01T00:00:00.000Z", municipality: "Oderzo",
  });
  const renamed = venueFixture({ name: "Al Giardinetto", aliases: ["Al Giardinetto"],
    canonical_venue_id: "venue:oderzo:al-giardinetto" });

  const durableId = fixture.store.rememberVenue(renamed, {
    checkedAt: "2026-03-02T00:00:00.000Z", municipality: "Oderzo",
  });
  const reused = fixture.store.findReusableEvidence(renamed, {
    at: "2026-03-02T00:00:00.000Z", municipality: "Oderzo",
  });
  assert.equal(durableId, "venue:oderzo:giardinetto");
  assert.equal(reused.matched_by, "durable_identity");
  assert.equal(reused.website, "https://giardinetto.example/");
});

test("same-name venues in one municipality never merge on an alias alone", async (t) => {
  const fixture = await storeFixture(t);
  const first = venueFixture({ canonical_venue_id: "venue:oderzo:centrale",
    name: "Bar Centrale", aliases: ["Bar Centrale"],
    source_records: [{ source_record_id: "overture:first", source: "overture_places" }] });
  const second = venueFixture({ canonical_venue_id: "venue:oderzo:centrale-second",
    name: "Bar Centrale", aliases: ["Bar Centrale"],
    source_records: [{ source_record_id: "overture:second", source: "overture_places" }] });
  assert.equal(fixture.store.rememberVenue(first, { municipality: "Oderzo" }),
    "venue:oderzo:centrale");
  assert.equal(fixture.store.rememberVenue(second, { municipality: "Oderzo" }),
    "venue:oderzo:centrale-second");
  assert.equal(fixture.store.db.prepare("SELECT COUNT(*) AS count FROM venues").get().count, 2);
});

test("confirmed closure retires accepted facts and prevents reuse", async (t) => {
  const fixture = await storeFixture(t);
  const venue = venueFixture();
  fixture.store.recordEnrichment(venue, acceptedEnrichment("https://barhacca.example/"), {
    checkedAt: "2026-04-01T00:00:00.000Z", municipality: "Oderzo",
  });
  fixture.store.confirmClosure(venue, {
    checkedAt: "2026-04-03T00:00:00.000Z", reason: "first_party_closure_notice",
    evidence: ["https://barhacca.example/chiusura"],
  }, { municipality: "Oderzo" });

  assert.equal(fixture.store.findReusableEvidence(venue, {
    at: "2026-04-04T00:00:00.000Z", municipality: "Oderzo",
  }), null);
  assert.deepEqual(fixture.store.auditFacts(venue).map((fact) => fact.lifecycle_status), ["retired", "retired"]);
});

test("positive contradictory evidence retires one fact, while mere absence does not", async (t) => {
  const fixture = await storeFixture(t);
  const venue = venueFixture();
  fixture.store.recordEnrichment(venue, acceptedEnrichment("https://old.example/"), {
    checkedAt: "2026-05-01T00:00:00.000Z", municipality: "Oderzo",
  });
  fixture.store.recordCheckOutcome(venue, {
    kind: "website", outcome: "not_observed", checkedAt: "2026-05-02T00:00:00.000Z",
    evidence: ["empty_search_fixture"],
  }, { municipality: "Oderzo" });
  assert.equal(fixture.store.findReusableEvidence(venue, {
    at: "2026-05-02T00:01:00.000Z", municipality: "Oderzo",
  }).website, "https://old.example/");

  fixture.store.recordCheckOutcome(venue, {
    kind: "website", factKey: "https://old.example/", outcome: "contradicted",
    checkedAt: "2026-05-03T00:00:00.000Z", reason: "domain_now_serves_unrelated_business",
    evidence: ["first_party_identity_conflict"],
  }, { municipality: "Oderzo" });
  assert.equal(fixture.store.findReusableEvidence(venue, {
    at: "2026-05-03T00:01:00.000Z", municipality: "Oderzo",
  }), null);
  assert.equal(fixture.store.auditFacts(venue).find((fact) => fact.kind === "website").retirement_reason,
    "domain_now_serves_unrelated_business");
});

test("store exposes migration and evidence version metadata", async (t) => {
  const fixture = await storeFixture(t);
  assert.equal(fixture.store.metadata().schema_version, EVIDENCE_SCHEMA_VERSION);
  assert.equal(fixture.store.metadata().evidence_version, 1);
  const enrichment = acceptedEnrichment("https://barhacca.example/");
  enrichment.enrichment_run.search_attempts = [{
    kind: "official_site_identity", query: '"Barhacca" "Oderzo"', result_count: 1,
    outcome: "relevant", provider: "fixture_api", cache: { status: "miss" },
    attempts: [{ provider: "fixture_api", http_status: 200, transport_ok: true,
      parse_ok: true, duration_ms: 12 }],
  }];
  fixture.store.recordEnrichment(venueFixture(), enrichment, {
    checkedAt: "2026-06-01T00:00:00.000Z", municipality: "Oderzo",
  });
  const attempt = fixture.store.db.prepare("SELECT * FROM search_attempts").get();
  assert.equal(attempt.provider, "fixture_api");
  assert.equal(attempt.http_status, 200);
  assert.equal(attempt.outcome, "relevant");
  assert.equal(attempt.cache_status, "miss");
  assert.equal(fixture.store.db.prepare("SELECT attempt_count FROM provider_health").get().attempt_count, 1);
});

test("opening a schema-v1 store migrates queue tables without losing evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "restaurant-evidence-v1-"));
  const path = join(directory, "evidence.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO metadata VALUES ('schema_version', '1');`);
  legacy.close();
  const store = new EvidenceStore(path);
  t.after(() => store.close());
  assert.equal(store.metadata().schema_version, EVIDENCE_SCHEMA_VERSION);
  assert.ok(store.db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'enrichment_jobs'`).get());
  assert.ok(store.db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'quota_pauses'`).get());
});

async function storeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "restaurant-evidence-"));
  const store = new EvidenceStore(join(directory, "evidence.sqlite"));
  t.after(() => { store.close(); return rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}

function venueFixture(overrides = {}) {
  return {
    canonical_venue_id: "venue:oderzo:barhacca",
    name: "Barhacca",
    aliases: ["Barhacca"],
    source_records: [{ source_record_id: "nominatim:node/42", source: "nominatim", name: "Barhacca" }],
    merge_audit: [],
    ...overrides,
  };
}

function acceptedEnrichment(website) {
  return {
    website,
    website_kind: "official",
    website_confidence: "high",
    website_decision: { status: "accepted", scores: { identity: 90, geography: 90, officialness: 90 },
      evidence: ["fixture_first_party_identity"] },
    website_provenance: { source: "fixture", origin: "validated_search_result", source_url: website,
      evidence: ["fixture_first_party_identity"], checked_at: "2026-01-01T00:00:00.000Z" },
    resources: [{ type: "webpage", role: "menu", url: `${website}menu`,
      found_via: "official_website", source_url: website, evidence: ["same_official_domain"],
      checked_at: "2026-01-01T00:00:00.000Z" }],
    resource_decisions: [],
    enrichment_run: { resolver_status: "accepted", resolver_stop_reason: "official_site_accepted",
      search_attempts: [], crawl_attempts: [] },
  };
}
