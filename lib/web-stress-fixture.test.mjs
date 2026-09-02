import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { classifyPublisherUrl, evaluateWebStress, normalizeCandidateUrl, prelabelWebFixture,
  joinWebStressEntries, validateWebAdjudicationDocument, validateWebAdjudicationSet,
  validateWebFixtureDocument, verifiedOwnershipPredictions, wilson } from "./web-stress-fixture.mjs";

const base = { schema_version: 1, source: "codex_integrated_web_search", brave_requests_made: 0,
  selection_fingerprint_sha256: "a".repeat(64), bounded_result_limit: 5, entries: [{
    venue_id: "venue:test", query: '"Test" "Roma" ristorante', retrieved_at: "2026-09-01T12:00:00Z",
    candidates: [{ title: "Test", url: "https://test.example/" }], adjudication: null,
  }] };

test("validates bounded minimal fixtures and only prelabels obvious publisher classes", () => {
  assert.equal(validateWebFixtureDocument(base, { expectedEntries: 1 }).candidates, 1);
  assert.equal(classifyPublisherUrl("https://restaurantguru.it/Test"), "directory");
  assert.equal(classifyPublisherUrl("https://unknown.example/Test"), "uncertain");
  assert.equal(normalizeCandidateUrl("https://EXAMPLE.test/path?utm_source=x&b=2&a=1#part"),
    "https://example.test/path?a=1&b=2");
  assert.equal(prelabelWebFixture({ ...base, entries: [{ ...base.entries[0], candidates: [
    { title: "Directory", url: "https://restaurantguru.it/Test" },
  ] }] }).entries[0].candidates[0].publisher_class, "directory");
  assert.throws(() => validateWebFixtureDocument({ ...base, brave_requests_made: 1 }), /zero-Brave/);
  assert.throws(() => validateWebFixtureDocument({ ...base, entries: [{ ...base.entries[0],
    candidates: [{ title: "x", url: "https://x.example/", snippet: "not retained" }] }] }),
  /uncontrolled result metadata/);
});

test("reports Wilson intervals and prevents a zero-publication system from passing", () => {
  const empty = evaluateWebStress([{ ...base.entries[0], adjudication: {
    official_website_status: "no_official_site", official_website_url: null,
    evidence_urls: ["https://registry.example/test"], reviewer: "reviewer",
    reviewed_at: "2026-09-01T12:00:00Z",
  }, prediction: { official_website_url: null } }]);
  assert.equal(empty.passes_non_vacuity, false);
  const interval = wilson(95, 100);
  assert.ok(interval.lower < 0.95 && interval.upper > 0.95);
});

test("scores publications against per-domain decisions without discarding reviewed abstentions", () => {
  const reviewed = { official_website_status: "uncertain", official_website_url: null,
    evidence_urls: ["https://directory.example/test"], reviewer: "reviewer",
    reviewed_at: "2026-09-01T12:00:00Z", domain_reviews: [{
      registrable_domain: "directory.example", publisher_class: "directory",
      ownership_status: "rejected", evidence_urls: ["https://directory.example/test"],
    }] };
  const result = evaluateWebStress([{ ...base.entries[0], adjudication: reviewed,
    prediction: { official_website_url: "https://directory.example/test" } },
  { ...base.entries[0], venue_id: "venue:abstain", adjudication: { ...reviewed,
    evidence_urls: ["https://directory.example/abstain"] },
  prediction: { official_website_url: null } }]);
  assert.equal(result.reviewed, 2);
  assert.equal(result.conclusive_publications, 1);
  assert.equal(result.false_publications, 1);
  assert.equal(result.false_publication_by_publisher_class.directory, 1);
  assert.equal(result.coverage, 0.5);
});

test("validates independent per-domain adjudication against the immutable bounded fixture", () => {
  const review = { schema_version: 1, partition: "development", source: "independent_fixture_review",
    selection_fingerprint_sha256: "a".repeat(64), reviewer: "fixture-reviewer",
    reviewed_at: "2026-09-01T12:30:00Z", entries: [{ venue_id: "venue:test",
      official_website_status: "uncertain", official_website_url: null,
      evidence_urls: ["https://test.example/"], domain_reviews: [{
        registrable_domain: "test.example", publisher_class: "uncertain",
        ownership_status: "uncertain", evidence_urls: ["https://test.example/"],
        uncertainty_reason: "The reviewed first-party page does not identify its operator.",
        uncertainty_reviewed_at: "2026-09-01T12:30:00Z",
        uncertainty_evidence_urls: ["https://test.example/"],
      }],
    }],
  };
  assert.equal(validateWebAdjudicationDocument(review, base).publisher_domains, 1);
  assert.throws(() => validateWebAdjudicationDocument({ ...review, entries: [{ ...review.entries[0],
    domain_reviews: [{ ...review.entries[0].domain_reviews[0], ownership_status: "verified" }],
  }] }, base), /requires an official/);
  assert.throws(() => validateWebAdjudicationDocument({ ...review, entries: [{ ...review.entries[0],
    evidence_urls: ["https://outside.example/"],
  }] }, base), /outside its bounded fixture/);
  assert.throws(() => validateWebAdjudicationDocument({ ...review, entries: [{ ...review.entries[0],
    domain_reviews: [{ ...review.entries[0].domain_reviews[0], uncertainty_reason: undefined }],
  }] }, base), /lacks a reviewed reason/);
  const verifiedDomain = { ...review.entries[0].domain_reviews[0], publisher_class: "official",
    ownership_status: "verified", ownership_method: "manual_first_party_review",
    ownership_reviewed_at: "2026-09-01T19:13:43Z",
    ownership_evidence_urls: ["https://test.example/privacy"], uncertainty_reason: undefined,
    uncertainty_reviewed_at: undefined, uncertainty_evidence_urls: undefined };
  const accepted = { ...review, entries: [{ ...review.entries[0], official_website_status: "accepted",
    official_website_url: "https://test.example/", domain_reviews: [verifiedDomain] }] };
  assert.equal(validateWebAdjudicationDocument(accepted, base).ownership_statuses.verified, 1);
  assert.throws(() => validateWebAdjudicationDocument({ ...accepted, entries: [{ ...accepted.entries[0],
    domain_reviews: [{ ...verifiedDomain, ownership_evidence_urls: [] }],
  }] }, base), /lacks durable evidence/);
  const joined = joinWebStressEntries(base, accepted, verifiedOwnershipPredictions(accepted));
  assert.equal(joined[0].adjudication.reviewer, "fixture-reviewer");
  assert.equal(evaluateWebStress(joined).true_publications, 1);
  assert.throws(() => validateWebAdjudicationDocument({ ...review, partition: "locked_holdout" }, base,
    { expectedPartition: "development" }), /partition mismatch/);
});

test("represents a conclusive no-site adjudication for a zero-result fixture", () => {
  const emptyFixture = { ...base, entries: [{ ...base.entries[0], candidates: [] }] };
  const adjudication = { schema_version: 1, partition: "development",
    source: "independent_fixture_review", selection_fingerprint_sha256: "a".repeat(64),
    reviewer: "fixture-reviewer", reviewed_at: "2026-09-02T12:00:00Z", entries: [{
      venue_id: "venue:test", official_website_status: "no_official_site",
      official_website_url: null, evidence_urls: [], domain_reviews: [],
    }] };
  assert.deepEqual(validateWebAdjudicationDocument(adjudication, emptyFixture), {
    venues: 1, publisher_domains: 0,
    publisher_classes: { official: 0, directory: 0, menu_mirror: 0,
      booking_or_order_platform: 0, editorial_or_review: 0, social: 0,
      unrelated: 0, uncertain: 0 },
    ownership_statuses: { verified: 0, rejected: 0, uncertain: 0 },
  });
  const joined = joinWebStressEntries(emptyFixture, adjudication,
    verifiedOwnershipPredictions(adjudication));
  assert.deepEqual(evaluateWebStress(joined), {
    reviewed: 1, publications: 0, conclusive_publications: 0, unresolved_publications: 0,
    true_publications: 0, false_publications: 0,
    false_publication_by_publisher_class: { official: 0, directory: 0, menu_mirror: 0,
      booking_or_order_platform: 0, editorial_or_review: 0, social: 0,
      unrelated: 0, uncertain: 0 },
    official_sites: 0, official_site_precision: null,
    official_site_precision_wilson_95: { lower: null, upper: null }, official_site_recall: null,
    official_site_recall_wilson_95: { lower: null, upper: null }, search_discovery_recall: null,
    search_discovery_recall_wilson_95: { lower: null, upper: null }, abstentions: 1, coverage: 0,
    passes_non_vacuity: false, passes_precision_target: false,
  });
});

test("validates complete Session 11 development adjudication artifacts as one set", async () => {
  const directory = new URL("../benchmark/session-11-web/", import.meta.url);
  const names = await readdir(directory);
  const loadMatching = async (pattern) => Promise.all(names.filter((name) => pattern.test(name)).sort()
    .map(async (name) => JSON.parse(await readFile(new URL(name, directory), "utf8"))));
  const fixtures = await loadMatching(/^development-\d{3}-\d{3}\.json$/);
  const adjudications = await loadMatching(/^development-adjudication-\d{3}-\d{3}\.json$/);
  const result = validateWebAdjudicationSet(adjudications, fixtures);
  assert.deepEqual(result, {
    venues: 200,
    publisher_domains: 715,
    publisher_classes: { official: 75, directory: 758, menu_mirror: 10,
      booking_or_order_platform: 36, editorial_or_review: 58, social: 1,
      unrelated: 38, uncertain: 11 },
    ownership_statuses: { verified: 30, rejected: 679, uncertain: 6 },
  });
  const entries = joinWebStressEntries(fixtures, adjudications,
    verifiedOwnershipPredictions(adjudications));
  assert.deepEqual(evaluateWebStress(entries), {
    reviewed: 200, publications: 29, conclusive_publications: 29, unresolved_publications: 0,
    true_publications: 29, false_publications: 0,
    false_publication_by_publisher_class: { official: 0, directory: 0, menu_mirror: 0,
      booking_or_order_platform: 0, editorial_or_review: 0, social: 0, unrelated: 0,
      uncertain: 0 },
    official_sites: 29, official_site_precision: 1,
    official_site_precision_wilson_95: wilson(29, 29), official_site_recall: 1,
    official_site_recall_wilson_95: wilson(29, 29), search_discovery_recall: 1,
    search_discovery_recall_wilson_95: wilson(29, 29), abstentions: 171, coverage: 0.145,
    passes_non_vacuity: true, passes_precision_target: false,
  });
});
