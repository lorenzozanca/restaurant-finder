import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { loadNationalVenueIndex } from "./lib/national-map.mjs";
import { publishNationalReview } from "./publish-national-review.mjs";
import { nextBatch } from "./prepare-national-batch.mjs";

const at = "2026-09-20T00:00:00.000Z";
const freeze = { reviewer: { verifier_model: "xiaomi/mimo-v2.6-pro", prompt_version: "llm-ownership-dev-3" } };

function remember(store, id, website) {
  store.rememberVenue({ canonical_venue_id: id, name: id, source_records: [{ source_record_id: `${id}:source`,
    source: "overture_places", name: id, municipality: "Roma", type: "restaurant", address: "Via Roma 1",
    latitude: 41.9, longitude: 12.5, website }] }, { checkedAt: at, municipality: "Roma" });
}

test("certified review outcomes publish verified and rejected websites to the national map", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "national-publish-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const review = new EvidenceStore(join(directory, "review.sqlite"));
  const national = new EvidenceStore(join(directory, "national.sqlite"));
  const venues = [["venue:ok", "https://ok.example/"], ["venue:dir", "https://dir.example/x"],
    ["venue:manual", "https://manual.example/"], ["venue:old", "https://old.example/"]];
  for (const store of [review, national]) for (const [id, url] of venues) remember(store, id, url);
  national.recordPublisherAttestation("venue:manual", { status: "verified", method: "manual_first_party_review",
    venue_id: "venue:manual", website_url: "https://manual.example/", evidence_urls: ["https://manual.example/"],
    reviewed_at: at, expires_at: "2027-09-25T00:00:00.000Z", reviewer: "human", source_kind: "human_review" },
  { recordedAt: at });
  const outcome = (id, url, verdict, model = freeze.reviewer.verifier_model) => {
    review.recordCandidateAssessment(id, { candidate_url: url, final_url: url, assessment_state: "strongly_correlated",
      crawl_outcome: "succeeded", scores: { identity: 90, geography: 90, officialness: 90 }, evidence: [],
      candidate_origin: "labelled_fixture" }, { checkedAt: at });
    review.recordLlmReviewOutcome("national-b001", id, url, { outcome: verdict, stage: "verifier",
      reasons: [], input_sha256: "d".repeat(64) }, { promptVersion: freeze.reviewer.prompt_version,
      verifierModel: model, finalUrl: url, at });
  };
  outcome("venue:ok", "https://ok.example/", "accepted");
  outcome("venue:dir", "https://dir.example/x", "rejected");
  outcome("venue:manual", "https://manual.example/", "rejected");
  outcome("venue:old", "https://old.example/", "accepted", "other/model");
  review.close();

  const counts = publishNationalReview(join(directory, "review.sqlite"), national, freeze);
  assert.deepEqual(counts, { assessments: 4, verified: 1, rejected: 1, skipped_manual: 1, skipped_unfrozen: 1 });
  assert.deepEqual(publishNationalReview(join(directory, "review.sqlite"), national, freeze), counts,
    "publishing again is idempotent");
  assert.throws(() => national.recordPublisherAttestation("venue:old", { status: "verified",
    method: "automated_llm_ownership_review", venue_id: "venue:old", website_url: "https://old.example/",
    evidence_urls: ["https://old.example/"], reviewed_at: at, expires_at: "2027-09-25T00:00:00.000Z",
    reviewer: "someone", source_kind: "human_review" }, { recordedAt: at }), /certified reviewer/);
  national.close();

  const index = loadNationalVenueIndex(join(directory, "national.sqlite"), { at: "2026-09-21T00:00:00.000Z" });
  assert.equal(index.stats.verified, 1, "the manual venue has no accepted website fact in this fixture");
  assert.equal(index.stats.rejected, 1);
  assert.equal(index.stats.assessed, 4);
});

test("national batches follow a fixed hash order and never repeat a venue", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ venue_id: `venue:${index}` }));
  const first = nextBatch(rows, new Set(), 4);
  const second = nextBatch(rows, new Set(first.map((row) => row.venue_id)), 4);
  assert.equal(first.length, 4);
  assert.deepEqual(nextBatch(rows, new Set(), 4), first);
  assert.equal(second.filter((row) => first.includes(row)).length, 0);
});
