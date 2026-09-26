import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./evidence-store.mjs";
import { loadNationalVenueIndex } from "./national-map.mjs";

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
  const one = index.venues.find((venue) => venue.id === "venue:one");
  assert.equal(one.status, "verified");
  assert.equal(one.candidate_assessment.state, "strongly_correlated");
  assert.equal(index.venues.find((venue) => venue.id === "venue:two").status, "no_candidate");
});

test("national map finds the assessment of a source URL with a fragment or tracking query", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "national-map-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "store.sqlite");
  const store = new EvidenceStore(path);
  remember(store, "venue:one", "One", "Padova", 45.4, 11.9, "https://one.example/?lang=it&utm_source=gmb#times");
  // Batches record the candidate as normalized by prepare-national-batch.mjs.
  store.recordCandidateAssessment("venue:one", {
    candidate_url: "https://one.example/?lang=it", final_url: "https://one.example/?lang=it",
    assessment_state: "ambiguous", crawl_outcome: "succeeded",
    scores: { identity: 50, geography: 50, officialness: 50 },
    evidence: [], candidate_origin: "labelled_fixture",
  }, { checkedAt: "2026-09-26T00:00:00Z" });
  store.close();

  const [one] = loadNationalVenueIndex(path, { at: "2026-09-26T01:00:00Z" }).venues;
  assert.equal(one.candidate_url, "https://one.example/?lang=it&utm_source=gmb#times");
  assert.equal(one.candidate_assessment?.state, "ambiguous");
});

function remember(store, id, name, municipality, latitude, longitude, website) {
  store.rememberVenue({ canonical_venue_id: id, name, source_records: [{
    source_record_id: `${id}:source`, source: "overture_places", name, municipality,
    province_code: "RM", type: "restaurant", address: `${name} street`, latitude, longitude,
    ...(website ? { website } : {}),
  }] }, { checkedAt: "2026-09-08T00:00:00Z", municipality });
}
