import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { evaluateLlmReview } from "./evaluate-llm-review.mjs";

const at = "2026-09-24T00:00:00.000Z";
const fingerprint = "b".repeat(64);

function fixtureEntry(venueId, url) {
  return { venue_id: venueId, name: venueId, municipality: "Esempio", region: "05", address: "Via Roma 1",
    partition: "development", query: "source_candidate", retrieved_at: at,
    candidates: [{ title: venueId, url }], adjudication: null };
}

function domainReview(domain, url, verified) {
  return verified
    ? { registrable_domain: domain, publisher_class: "official", ownership_status: "verified",
      evidence_urls: [url], ownership_method: "manual_first_party_review", ownership_reviewed_at: at,
      ownership_evidence_urls: [url] }
    : { registrable_domain: domain, publisher_class: "directory", ownership_status: "rejected",
      evidence_urls: [url] };
}

test("a publication that redirected to an unlabelled domain is scored by its candidate's label", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "llm-review-eval-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const moved = "https://old-trattoria.example/";
  const listing = "https://listing.example/esempio";
  await writeFile(join(directory, "development-001-002.json"), JSON.stringify({ schema_version: 1,
    fixture_set: "test", source: "source_candidate", brave_requests_made: 0,
    selection_fingerprint_sha256: fingerprint, bounded_result_limit: 1,
    entries: [fixtureEntry("venue:moved", moved), fixtureEntry("venue:listing", listing)] }));
  await writeFile(join(directory, "development-adjudication-001-002.json"), JSON.stringify({
    schema_version: 1, partition: "development", source: "independent_fixture_review",
    selection_fingerprint_sha256: fingerprint, reviewer: "test labeller", reviewed_at: at,
    entries: [
      { venue_id: "venue:moved", official_website_status: "accepted", official_website_url: moved,
        evidence_urls: [moved], domain_reviews: [domainReview("old-trattoria.example", moved, true)] },
      { venue_id: "venue:listing", official_website_status: "no_official_site", official_website_url: null,
        evidence_urls: [listing], domain_reviews: [domainReview("listing.example", listing, false)] },
    ] }));
  const dbPath = join(directory, "review.sqlite");
  const store = new EvidenceStore(dbPath);
  const review = { outcome: "accepted", stage: "verifier", publisher_kind: "official venue", reasons: [],
    input_sha256: "c".repeat(64) };
  const meta = { promptVersion: "test", verifierModel: "test/model", at };
  store.recordLlmReviewOutcome("run", "venue:moved", moved, review,
    { ...meta, finalUrl: "https://new-trattoria.example/" });
  store.recordLlmReviewOutcome("run", "venue:listing", listing, review,
    { ...meta, finalUrl: "https://unrelated.example/" });
  store.close();

  const report = evaluateLlmReview({ partition: "development", runId: "run", dbPath,
    fixtureDirectories: [directory] });
  assert.equal(report.venue_metrics.publications, 2);
  assert.equal(report.venue_metrics.true_publications, 1);
  assert.deepEqual(report.false_publications.map((item) => item.venue_id), ["venue:listing"]);
});
