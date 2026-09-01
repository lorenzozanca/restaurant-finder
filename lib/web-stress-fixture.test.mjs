import test from "node:test";
import assert from "node:assert/strict";
import { classifyPublisherUrl, evaluateWebStress, normalizeCandidateUrl, prelabelWebFixture,
  validateWebFixtureDocument, wilson } from "./web-stress-fixture.mjs";

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
