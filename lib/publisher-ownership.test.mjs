import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePublisherOwnership,
  publisherOwnershipFromReview,
  registrableDomain,
} from "./publisher-ownership.mjs";

const restaurant = {
  canonical_venue_id: "venue:test",
  publisher_ownership: [{
    status: "verified",
    method: "manual_first_party_review",
    venue_id: "venue:test",
    website_url: "https://www.example-venue.it/",
    evidence_urls: ["https://registry.test/example-venue"],
    reviewed_at: "2026-09-01T12:00:00Z",
    reviewer: "Independent reviewer",
  }],
};

test("a venue-scoped attestation verifies the same publisher across subdomains", () => {
  const decision = evaluatePublisherOwnership("https://menu.example-venue.it/carta", restaurant);
  assert.equal(decision.status, "verified");
  assert.equal(decision.reason, "venue_scoped_attestation_matches_publisher");
  assert.equal(registrableDomain(decision.website_url), "example-venue.it");
});

test("page content and a branded unseen hostname cannot create ownership", () => {
  const decision = evaluatePublisherOwnership(
    "https://example-venue.generated-directory.invalid/menu", restaurant,
  );
  assert.deepEqual(decision, {
    status: "unverified", method: null, reason: "no_matching_ownership_attestation",
  });
});

test("an attestation for another venue cannot be reused", () => {
  const decision = evaluatePublisherOwnership("https://www.example-venue.it/", {
    ...restaurant, canonical_venue_id: "venue:other",
  });
  assert.equal(decision.status, "unverified");
  assert.equal(decision.reason, "invalid_ownership_attestation");
});

test("review records become auditable ownership attestations only when complete", () => {
  assert.equal(publisherOwnershipFromReview({ official_website_status: "missing" }).length, 0);
  const [attestation] = publisherOwnershipFromReview({
    official_website_status: "accepted",
    official_website_url: "https://venue.example/",
    evidence_urls: ["https://municipality.example/venue"],
    reviewed_at: "2026-09-01T12:00:00Z",
    reviewer: "Reviewer",
  }, "venue:test");
  assert.equal(attestation.status, "verified");
  assert.equal(attestation.venue_id, "venue:test");
});
