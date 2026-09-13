import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./evidence-store.mjs";
import { loadNationalVenueIndex, queryNationalVenueIndex } from "./national-map.mjs";

test("national map keeps candidates visible and distinguishes verified venues", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "national-map-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "store.sqlite");
  const store = new EvidenceStore(path);
  remember(store, "venue:one", "One", "Roma", 41.9, 12.5, "https://one.example/");
  remember(store, "venue:two", "Two", "Roma", 41.91, 12.51, "");
  store.recordEnrichment({ canonical_venue_id: "venue:one", name: "One" }, {
    website: "https://one.example/",
    website_decision: { status: "accepted", scores: {}, confidence: "high", evidence: [] },
    resources: [], resource_decisions: [], enrichment_run: {},
  }, { checkedAt: "2026-09-08T00:00:00Z", municipality: "Roma" });
  store.recordPublisherAttestation("venue:one", {
    status: "verified", method: "manual_first_party_review", venue_id: "venue:one",
    website_url: "https://one.example/", evidence_urls: ["https://one.example/"],
    reviewed_at: "2026-09-08T00:00:00Z", expires_at: "2027-09-08T00:00:00Z",
    reviewer: "test", source_kind: "human_review",
  }, { recordedAt: "2026-09-08T01:00:00Z" });
  store.recordCandidateAssessment("venue:one", {
    candidate_url: "https://one.example/", final_url: "https://one.example/",
    assessment_state: "strongly_correlated", crawl_outcome: "succeeded",
    scores: { identity: 90, geography: 80, officialness: 85 },
    evidence: ["phone_match"], candidate_origin: "source_provided",
  }, { checkedAt: "2026-09-08T01:30:00Z" });
  store.close();

  const index = loadNationalVenueIndex(path, { at: "2026-09-08T02:00:00Z" });
  assert.deepEqual(index.stats, {
    venues: 2, source_candidates: 1, verified: 1, rejected: 0, no_candidate: 1, assessed: 1,
    assessments: { strongly_correlated: 1, ambiguous: 0, contradicted: 0,
      retryable: 0, unsupported_publisher: 0 },
  });
  const roma = queryNationalVenueIndex(index, { query: "Roma", zoom: 6 });
  assert.equal(roma.mode, "venues");
  assert.deepEqual(roma.features.map((feature) => feature.properties.status).sort(), ["no_candidate", "verified"]);
  assert.equal(roma.features.find((feature) => feature.properties.id === "venue:one")
    .properties.candidate_assessment.state, "strongly_correlated");
  const candidates = queryNationalVenueIndex(index, { status: "candidate", zoom: 6 });
  assert.equal(candidates.mode, "clusters");
  assert.equal(candidates.group_level, "grid");
  assert.equal(candidates.visible_count, 1);
});

test("national map shows numeric counts from far away and dots up close", () => {
  const index = syntheticIndex([
    venue("a", "Alpha", "Roma", "RM", "12", 41.9, 12.5, "https://a.example/"),
    venue("b", "Beta", "Milano", "MI", "03", 45.46, 9.19, ""),
    venue("c", "Gamma", "Milano", "MI", "03", 45.47, 9.2, "https://c.example/"),
  ]);
  const far = queryNationalVenueIndex(index, { zoom: 5 });
  assert.equal(far.mode, "clusters");
  assert.equal(far.group_level, "grid");
  assert.equal(far.visible_count, 3);
  assert.equal(sumCounts(far), 3);
  for (const feature of far.features) {
    assert.equal(feature.properties.kind, "cluster");
    assert.ok(feature.properties.count >= 1);
    assert.equal(feature.properties.bounds.length, 4);
  }

  const mid = queryNationalVenueIndex(index, { zoom: 8 });
  assert.equal(mid.mode, "clusters");
  assert.equal(sumCounts(mid), 3);
  assert.ok(mid.features.length >= far.features.length);

  const close = queryNationalVenueIndex(index, { zoom: 12 });
  assert.equal(close.mode, "venues");
  assert.equal(close.features.length, 3);
});

test("national map keeps clusters at mid zoom even when venues are few", () => {
  const index = syntheticIndex([
    venue("a", "Alpha", "Roma", "RM", "12", 41.9, 12.5, ""),
    venue("b", "Beta", "Roma", "RM", "12", 41.91, 12.51, ""),
  ]);
  const mid = queryNationalVenueIndex(index, { zoom: 11 });
  assert.equal(mid.mode, "clusters");
  assert.equal(sumCounts(mid), 2);
});

test("national map caps dense areas with grid clusters and truncates search", () => {
  const venues = [];
  for (let i = 0; i < 3000; i++) {
    venues.push(venue(`g${i}`, `Grid ${i}`, "Roma", "RM", "12",
      41.9 + (i % 50) * 0.001, 12.5 + (i % 50) * 0.001, ""));
  }
  const index = syntheticIndex(venues);
  const grid = queryNationalVenueIndex(index, { zoom: 12, limit: 2000 });
  assert.equal(grid.mode, "clusters");
  assert.equal(grid.group_level, "grid");
  assert.ok(grid.features.length <= 2500);
  assert.ok(grid.features[0].properties.bounds.length === 4);

  const search = queryNationalVenueIndex(index, { query: "roma", limit: 2000 });
  assert.equal(search.mode, "venues");
  assert.equal(search.features.length, 2000);
  assert.equal(search.truncated, true);
  assert.equal(search.visible_count, 3000);
});

function sumCounts(document) {
  return document.features.reduce((sum, feature) => sum + feature.properties.count, 0);
}

function syntheticIndex(venues) {
  return {
    venues,
    stats: { venues: venues.length },
    generated_at: "2026-09-13T00:00:00Z",
  };
}

function venue(id, name, municipality, province, region, latitude, longitude, website) {
  return {
    id, name, municipality, province, region, type: "restaurant",
    address: "", phone: "", latitude, longitude,
    candidate_url: website, candidate_assessment: null,
    verified_url: "", menu_url: "",
    status: website ? "candidate" : "no_candidate",
    search: `${name} ${municipality} ${province}`.toLowerCase(),
  };
}

function remember(store, id, name, municipality, latitude, longitude, website) {
  store.rememberVenue({ canonical_venue_id: id, name, source_records: [{
    source_record_id: `${id}:source`, source: "overture_places", name, municipality,
    province_code: "RM", type: "restaurant", address: `${name} street`, latitude, longitude,
    ...(website ? { website } : {}),
  }] }, { checkedAt: "2026-09-08T00:00:00Z", municipality });
}
