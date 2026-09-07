import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { exportVerifiedMap } from "./export-verified-map.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "verified-map-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new EvidenceStore(join(directory, "evidence.sqlite"));
  t.after(() => store.close());
  return store;
}

function rememberAttested(store, venue, website) {
  const id = store.rememberVenue({ canonical_venue_id: venue.id, name: venue.name,
    latitude: venue.latitude, longitude: venue.longitude,
    municipality: venue.municipality,
    source_records: [{ source_record_id: `${venue.id}:record`, ...venue }] },
  { checkedAt: "2026-09-07T00:00:00Z", municipality: venue.municipality });
  store.recordEnrichment({ canonical_venue_id: id, name: venue.name }, {
    website,
    website_decision: { status: "accepted", scores: { identity: 90, geography: 80, officialness: 90 },
      confidence: "high", evidence: ["publisher_ownership_verified"] },
    resources: website && venue.menu ? [{ url: venue.menu, role: "menu", type: "webpage",
      confidence: "high", evidence: ["same_official_domain", "menu_anchor"],
      http_status: 200, content_type: "text/html" }] : [],
    resource_decisions: [],
    enrichment_run: { strategy: "website_first", resolver_status: "accepted",
      resolver_stop_reason: "official_site_accepted", search_attempts: [], crawl_attempts: [] },
  }, { checkedAt: "2026-09-07T00:00:00Z", municipality: venue.municipality });
  store.recordPublisherAttestation(id, {
    status: "verified", method: "manual_first_party_review", venue_id: id,
    website_url: website, evidence_urls: [website],
    reviewed_at: "2026-09-07T00:00:00Z", expires_at: "2027-09-07T00:00:00Z",
    reviewer: "test review", source_kind: "human_review",
  }, { reason: "test", recordedAt: "2026-09-07T01:00:00Z" });
  return id;
}

test("exports only attested venues with coordinates and menu links", (t) => {
  const store = fixture(t);
  rememberAttested(store, { id: "venue:good", name: "Good Trattoria", municipality: "Oderzo",
    latitude: 45.78, longitude: 12.49 }, "https://good.test/");
  // Attested venue without coordinates is skipped and reported.
  const noCoords = store.rememberVenue({ canonical_venue_id: "venue:nocoords", name: "No Coords" },
    { checkedAt: "2026-09-07T00:00:00Z", municipality: "Oderzo" });
  store.recordEnrichment({ canonical_venue_id: noCoords, name: "No Coords" }, {
    website: "https://nocoords.test/",
    website_decision: { status: "accepted", scores: {}, confidence: "high", evidence: [] },
    resources: [], resource_decisions: [],
    enrichment_run: { strategy: "website_first", resolver_status: "accepted",
      resolver_stop_reason: "official_site_accepted", search_attempts: [], crawl_attempts: [] },
  }, { checkedAt: "2026-09-07T00:00:00Z", municipality: "Oderzo" });
  store.recordPublisherAttestation(noCoords, {
    status: "verified", method: "manual_first_party_review", venue_id: noCoords,
    website_url: "https://nocoords.test/", evidence_urls: ["https://nocoords.test/"],
    reviewed_at: "2026-09-07T00:00:00Z", expires_at: "2027-09-07T00:00:00Z",
    reviewer: "test review", source_kind: "human_review",
  }, { reason: "test", recordedAt: "2026-09-07T01:00:00Z" });
  // Enriched but unattested venue stays in the backlog.
  const plain = store.rememberVenue({ canonical_venue_id: "venue:plain", name: "Plain Bar",
    latitude: 45.79, longitude: 12.5,
    source_records: [{ source_record_id: "venue:plain:record", latitude: 45.79, longitude: 12.5,
      municipality: "Oderzo" }] }, { checkedAt: "2026-09-07T00:00:00Z", municipality: "Oderzo" });
  store.recordEnrichment({ canonical_venue_id: plain, name: "Plain Bar" }, {
    website: "https://plain.test/",
    website_decision: { status: "accepted", scores: {}, confidence: "high", evidence: [] },
    resources: [], resource_decisions: [],
    enrichment_run: { strategy: "website_first", resolver_status: "accepted",
      resolver_stop_reason: "official_site_accepted", search_attempts: [], crawl_attempts: [] },
  }, { checkedAt: "2026-09-07T00:00:00Z", municipality: "Oderzo" });

  const { features, skippedNoCoordinates } = exportVerifiedMap(store,
    { at: "2026-09-08T00:00:00Z" });
  assert.equal(features.length, 1);
  assert.equal(skippedNoCoordinates, 1);
  const [feature] = features;
  assert.equal(feature.geometry.type, "Point");
  assert.deepEqual(feature.geometry.coordinates, [12.49, 45.78]);
  assert.equal(feature.properties.name, "Good Trattoria");
  assert.equal(feature.properties.website, "https://good.test/");
  assert.equal(feature.properties.municipality, "Oderzo");
});
