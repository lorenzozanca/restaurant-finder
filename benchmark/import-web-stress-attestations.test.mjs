import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../lib/evidence-store.mjs";
import {
  collectVerifiedAttestations,
  importWebStressAttestations,
} from "./import-web-stress-attestations.mjs";

function adjudication(entries, overrides = {}) {
  return {
    schema_version: 1,
    partition: "locked_holdout",
    source: "independent_fixture_review",
    selection_fingerprint_sha256: "a".repeat(64),
    reviewer: "independent review",
    reviewed_at: "2026-09-07T15:30:00.000Z",
    entries,
    ...overrides,
  };
}

function acceptedEntry(venueId, url) {
  const domain = new URL(url).hostname.replace(/^www\./, "");
  return {
    venue_id: venueId,
    official_website_status: "accepted",
    official_website_url: url,
    evidence_urls: [url],
    domain_reviews: [{
      registrable_domain: domain,
      publisher_class: "official",
      ownership_status: "verified",
      evidence_urls: [url],
      ownership_method: "manual_first_party_review",
      ownership_reviewed_at: "2026-09-07T15:30:00.000Z",
      ownership_evidence_urls: [url],
    }],
  };
}

function storeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "web-stress-import-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new EvidenceStore(join(directory, "evidence.sqlite"));
  t.after(() => store.close());
  return store;
}

function remember(store, venueId) {
  store.rememberVenue({ canonical_venue_id: venueId, name: `Venue ${venueId}` },
    { municipality: "Testown", checkedAt: "2026-09-07T00:00:00.000Z" });
}

test("imports only accepted websites with verified domain ownership", (t) => {
  const store = storeFixture(t);
  remember(store, "venue:a");
  remember(store, "venue:b");
  remember(store, "venue:c");
  const document = adjudication([
    acceptedEntry("venue:a", "https://www.a-example.test/"),
    { venue_id: "venue:b", official_website_status: "no_official_site",
      official_website_url: null, evidence_urls: [], domain_reviews: [] },
    { venue_id: "venue:c", official_website_status: "uncertain",
      official_website_url: null, evidence_urls: ["https://directory.test/c"],
      domain_reviews: [{ registrable_domain: "directory.test", publisher_class: "directory",
        ownership_status: "uncertain", evidence_urls: ["https://directory.test/c"],
        uncertainty_reason: "needs inspection",
        uncertainty_reviewed_at: "2026-09-07T15:30:00.000Z",
        uncertainty_evidence_urls: ["https://directory.test/c"] }] },
  ]);
  const result = importWebStressAttestations(store, document);
  assert.equal(result.imported, 1);
  assert.equal(result.unchanged, 0);
  assert.equal(result.accepted, 1);
  assert.ok(store.hasActivePublisherAttestation("venue:a", "https://www.a-example.test/"));
  assert.equal(store.hasActivePublisherAttestation("venue:b", "https://b.test/"), false);
  assert.equal(store.hasActivePublisherAttestation("venue:c", "https://directory.test/c"), false);
});

test("re-import is idempotent and cross-document venue duplicates are skipped", (t) => {
  const store = storeFixture(t);
  remember(store, "venue:a");
  remember(store, "venue:b");
  const first = adjudication([acceptedEntry("venue:a", "https://www.a-example.test/")]);
  const second = adjudication([
    acceptedEntry("venue:a", "https://www.a-example.test/"),
    acceptedEntry("venue:b", "https://www.b-example.test/"),
  ], { selection_fingerprint_sha256: "b".repeat(64) });
  assert.deepEqual(importWebStressAttestations(store, first), {
    imported: 1, unchanged: 0, skipped_duplicates: 0, accepted: 1,
    venues: [{ venue_id: "venue:a", website_url: "https://www.a-example.test/" }],
  });
  const rerun = importWebStressAttestations(store, first);
  assert.equal(rerun.imported, 0);
  assert.equal(rerun.unchanged, 1);
  const combined = importWebStressAttestations(store, [first, second]);
  assert.equal(combined.skipped_duplicates, 1);
  assert.equal(combined.imported, 1);
  assert.equal(combined.unchanged, 1);
  assert.equal(combined.accepted, 2);
  assert.ok(store.hasActivePublisherAttestation("venue:b", "https://www.b-example.test/"));
});

test("duplicate evidence URLs are deduped to satisfy store validation", (t) => {
  const store = storeFixture(t);
  remember(store, "venue:a");
  const entry = acceptedEntry("venue:a", "https://www.a-example.test/");
  entry.domain_reviews[0].ownership_evidence_urls = [
    "https://www.a-example.test/",
    "https://www.a-example.test/",
  ];
  const result = importWebStressAttestations(store, adjudication([entry]));
  assert.equal(result.imported, 1);
  const row = store.listPublisherAttestations({ venueId: "venue:a" })[0];
  assert.deepEqual(row.evidence_urls, ["https://www.a-example.test/"]);
});

test("accepted website without verified domain ownership fails closed", (t) => {
  const document = adjudication([{
    venue_id: "venue:x",
    official_website_status: "accepted",
    official_website_url: "https://www.x-example.test/",
    evidence_urls: ["https://directory.test/x"],
    domain_reviews: [{ registrable_domain: "directory.test", publisher_class: "directory",
      ownership_status: "rejected", evidence_urls: ["https://directory.test/x"] }],
  }]);
  assert.throws(() => collectVerifiedAttestations(document),
    /lacks verified domain ownership/);
});

test("documents without fingerprint, reviewer, or review provenance are rejected", (t) => {
  const base = [acceptedEntry("venue:a", "https://www.a-example.test/")];
  assert.throws(() => collectVerifiedAttestations(adjudication(base, {
    selection_fingerprint_sha256: "short",
  })), /fingerprint/);
  assert.throws(() => collectVerifiedAttestations(adjudication(base, { reviewer: "" })),
    /reviewer/);
  assert.throws(() => collectVerifiedAttestations({ schema_version: 1,
    source: "independent_fixture_review",
    selection_fingerprint_sha256: "a".repeat(64),
    reviewer: "reviewer", reviewed_at: "2026-09-07T00:00:00Z" }), /invalid web adjudication/);
});

test("attestation for a venue missing from the store fails with venue mismatch", (t) => {
  const store = storeFixture(t);
  const document = adjudication([acceptedEntry("venue:ghost", "https://www.ghost.test/")]);
  assert.throws(() => importWebStressAttestations(store, document), /does not exist/);
});
