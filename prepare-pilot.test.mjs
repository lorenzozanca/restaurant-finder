import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EnrichmentQueue } from "./lib/enrichment-queue.mjs";
import { preparePilotDatabase, validatePilotReviews } from "./prepare-pilot.mjs";

function reviewed(venueId, status = "valid") {
  return { selection_index: 1, venue_id: venueId, municipality: "Test Town", review: {
    reviewer: "reviewer", reviewed_at: "2026-08-28T00:00:00Z", venue_status: status,
    municipality_assignment: "correct", duplicate_of_venue_id: null,
    official_website_status: "no_official_site", official_website_url: null,
    resources: [], evidence_urls: ["https://example.test/evidence"], notes: "checked",
  } };
}

test("review validation fails closed and counts approved candidates", () => {
  assert.deepEqual(validatePilotReviews({ candidates: [reviewed("venue:one")] }),
    { reviewed: 1, approved: 1, uncertain: 0 });
  const invalid = reviewed("venue:bad");
  invalid.review.evidence_urls = [];
  assert.throws(() => validatePilotReviews({ candidates: [invalid] }), /evidence URL/);
});

test("pilot preparation copies only approved untouched jobs into a fresh store", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "restaurant-pilot-"));
  const sourcePath = join(dir, "source.sqlite");
  const targetPath = join(dir, "pilot.sqlite");
  const source = new EnrichmentQueue(sourcePath);
  t.after(() => source.close());
  for (const id of ["venue:approved", "venue:uncertain"]) source.enqueue({
    venue: { canonical_venue_id: id, name: id, source_records: [{
      source_record_id: `source:${id}`, source: "fixture", name: id,
    }] }, municipality: "Test Town", stage: "website_and_resources",
    idempotencyKey: `${id}:enrich`, maxAttempts: 4, payload: { municipality: "Test Town" },
  });
  const result = preparePilotDatabase({ sourcePath, targetPath, manifest: { candidates: [
    reviewed("venue:approved"), reviewed("venue:uncertain", "uncertain"),
  ] } });
  assert.equal(result.approved, 1);
  const pilot = new EnrichmentQueue(targetPath);
  t.after(() => pilot.close());
  assert.deepEqual(pilot.status().counts, { queued: 1 });
  assert.equal(pilot.db.prepare("SELECT max_attempts FROM enrichment_jobs").get().max_attempts, 2);
  assert.equal(pilot.db.prepare("SELECT COUNT(*) AS count FROM venues").get().count, 1);
});
