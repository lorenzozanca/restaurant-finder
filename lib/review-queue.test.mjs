import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "./evidence-store.mjs";
import { buildReviewDecision, recordReviewDecision } from "./review-queue.mjs";

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
  assert.throws(() => buildReviewDecision(decision({ candidate_domain: "other.example" }), { now: NOW }),
    /presented candidate domain/);
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

test("recorded review decisions write attestations without publishing facts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "review-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const setup = new EvidenceStore(db);
  setup.rememberVenue({
    canonical_venue_id: "venue:test:review", name: "Review Venue",
    source_records: [{ source_record_id: "overture:1", source: "overture_places",
      name: "Review Venue", website: "https://venue.example/" }],
  }, { checkedAt: "2026-09-01T00:00:00Z", municipality: "Torino" });
  setup.close();

  assert.throws(() => recordReviewDecision(db, decision({
    candidate_domain: "invented.example", website_url: "https://invented.example/",
  }), { now: NOW }), /not a stored candidate/);

  const created = recordReviewDecision(db, decision(), { now: NOW });
  assert.equal(created.publisher_domain, "venue.example");
  assert.equal(created.status, "verified");

  const reopened = new EvidenceStore(db);
  try {
    assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM facts").get().count, 0,
      "review decisions must not publish facts");
    const candidate = reopened.nextReviewCandidate({});
    assert.equal(candidate, null, "attested venue leaves the review queue");
  } finally {
    reopened.close();
  }
});
