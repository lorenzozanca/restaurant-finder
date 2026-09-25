import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "./evidence-store.mjs";
import { loadNationalVenueIndex } from "./national-map.mjs";
import { buildReviewDecision, recordReviewDecision, venueReview } from "./review-queue.mjs";

const NOW = new Date("2026-06-10T00:00:00.000Z");

function decision(overrides = {}) {
  return {
    venue_id: "venue:test:review",
    candidate_domain: "venue.example",
    decision: "approve",
    website_url: "https://venue.example/",
    evidence_urls: ["https://venue.example/contatti"],
    reviewer: "operator",
    ...overrides,
  };
}

test("approve maps to a verified human-review attestation with a one-year expiry", () => {
  const built = buildReviewDecision(decision(), { now: NOW });
  assert.equal(built.venueId, "venue:test:review");
  assert.equal(built.attestation.status, "verified");
  assert.equal(built.attestation.method, "manual_first_party_review");
  assert.equal(built.attestation.source_kind, "human_review");
  assert.equal(built.attestation.reviewed_at, NOW.toISOString());
  assert.equal(built.attestation.expires_at, "2027-06-10T00:00:00.000Z");
  assert.equal(built.reason, "review_queue_decision");
});

test("reject maps to a rejected attestation for the same domain", () => {
  const built = buildReviewDecision(decision({ decision: "reject" }), { now: NOW });
  assert.equal(built.attestation.status, "rejected");
  assert.equal(built.attestation.method, "manual_first_party_review");
});

test("registry hints and candidate-domain mismatches cannot mint attestations", () => {
  assert.throws(() => buildReviewDecision(decision({ method: "official_registry" }), { now: NOW }),
    /must use manual_first_party_review/);
  assert.throws(() => buildReviewDecision(decision({
    decision: "reject", candidate_domain: "other.example",
  }), { now: NOW }),
    /presented candidate domain/);
  const corrected = buildReviewDecision(decision({
    candidate_domain: "old.example", website_url: "https://venue.example/",
  }), { now: NOW });
  assert.equal(corrected.candidateDomain, "old.example");
  assert.equal(corrected.attestation.website_url, "https://venue.example/");
});

test("detector methods and malformed clicks fail closed", () => {
  assert.throws(() => buildReviewDecision(decision({ method: "verified_reciprocal_link" }), { now: NOW }),
    /must use manual_first_party_review/);
  assert.throws(() => buildReviewDecision(decision({ decision: "maybe" }), { now: NOW }), /approve.*reject/);
  assert.throws(() => buildReviewDecision(decision({ website_url: "" }), { now: NOW }), /website_url/);
  assert.throws(() => buildReviewDecision(decision({ evidence_urls: [] }), { now: NOW }), /evidence URL/);
  assert.throws(() => buildReviewDecision(decision({ reviewer: "  " }), { now: NOW }), /reviewer/);
  assert.throws(() => buildReviewDecision(decision({ venue_id: "" }), { now: NOW }), /venue_id/);
  assert.throws(() => buildReviewDecision(decision({ candidate_domain: "" }), { now: NOW }),
    /candidate_domain/);
});

test("an approval publishes the website on the map; a rejection records only the attestation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const setup = new EvidenceStore(db);
  for (const [id, website] of [["venue:test:review", "https://venue.example/"], ["venue:test:other", "https://dir.example/x"]]) {
    setup.rememberVenue({
      canonical_venue_id: id, name: "Review Venue",
      source_records: [{ source_record_id: `${id}:overture`, source: "overture_places", name: "Review Venue",
        municipality: "Torino", latitude: 45.07, longitude: 7.68, website }],
    }, { checkedAt: "2026-09-01T00:00:00Z", municipality: "Torino" });
  }
  setup.close();

  assert.throws(() => recordReviewDecision(db, decision({ candidate_domain: "invented.example" }),
    { now: NOW }), /not a stored candidate/);
  assert.throws(() => recordReviewDecision(db, decision({ venue_id: "venue:missing" }), { now: NOW }),
    /not a stored candidate/);

  const created = recordReviewDecision(db, decision(), { now: NOW });
  assert.equal(created.publisher_domain, "venue.example");
  assert.equal(created.status, "verified");
  const rejected = recordReviewDecision(db, decision({ venue_id: "venue:test:other", candidate_domain: "dir.example",
    decision: "reject", website_url: "https://dir.example/x", evidence_urls: ["https://dir.example/x"] }), { now: NOW });
  assert.equal(rejected.status, "rejected");

  const reopened = new EvidenceStore(db);
  try {
    const facts = reopened.db.prepare(`SELECT venue_id, fact_key FROM facts WHERE kind = 'website'
      AND decision_status = 'accepted' AND lifecycle_status = 'active'`).all();
    assert.deepEqual(facts.map((row) => [row.venue_id, row.fact_key]), [["venue:test:review", "https://venue.example/"]],
      "only the approval publishes a website fact");
  } finally {
    reopened.close();
  }
  const index = loadNationalVenueIndex(db, { at: "2026-06-11T00:00:00.000Z" });
  assert.equal(index.stats.verified, 1);
  assert.equal(index.stats.rejected, 1);

  const detail = venueReview(db, "venue:test:review", { at: "2026-06-11T00:00:00.000Z" });
  assert.deepEqual(detail.candidates.map((item) => item.domain), ["venue.example"]);
  assert.deepEqual(detail.candidates[0].origins, ["source:overture_places", "fact:accepted"]);
  assert.equal(detail.attestations[0].status, "verified");
  assert.equal(detail.attestations[0].reviewer, "operator");
  assert.equal(detail.llm, null);
});

test("a corrected website replaces the published one for that venue", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const setup = new EvidenceStore(db);
  setup.rememberVenue({ canonical_venue_id: "venue:test:review", name: "Review Venue",
    source_records: [{ source_record_id: "overture:1", source: "overture_places", name: "Review Venue",
      website: "https://old.example/" }] }, { checkedAt: "2026-09-01T00:00:00Z", municipality: "Torino" });
  setup.close();
  recordReviewDecision(db, decision({ candidate_domain: "old.example", website_url: "https://old.example/" }), { now: NOW });
  recordReviewDecision(db, decision({ candidate_domain: "old.example", website_url: "https://new.example/" }),
    { now: new Date("2026-06-12T00:00:00.000Z") });
  const store = new EvidenceStore(db);
  try {
    assert.deepEqual(store.db.prepare(`SELECT fact_key FROM facts WHERE kind = 'website'
      AND decision_status = 'accepted' AND lifecycle_status = 'active'`).all().map((row) => row.fact_key),
    ["https://new.example/"]);
  } finally {
    store.close();
  }
});
