import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { runQueueCommand } from "./queue-ops.mjs";

test("bounded ownership operator commands approve, inspect, and revoke without publishing", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ownership-ops-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const store = new EvidenceStore(db, { clock: () => new Date("2026-09-02T00:00:00Z") });
  store.rememberVenue({ canonical_venue_id: "venue:test", name: "Test Venue", source_records: [] },
    { checkedAt: "2026-09-01T00:00:00Z", municipality: "Roma" });
  store.close();

  const unattested = await runQueueCommand(["ownership-unattested", "--db", db, "--limit", "1"]);
  assert.equal(unattested[0].venue_id, "venue:test");
  await runQueueCommand(["ownership-approve", "--db", db, "--venue", "venue:test",
    "--website", "https://venue.example/", "--evidence", "https://venue.example/contact",
    "--reviewer", "operator", "--reviewed-at", "2026-09-01T00:00:00Z",
    "--expires-at", "2027-09-01T00:00:00Z"]);
  const listed = await runQueueCommand(["ownership-list", "--db", db, "--venue", "venue:test"]);
  assert.equal(listed[0].publisher_domain, "venue.example");

  const reopened = new EvidenceStore(db);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM facts").get().count, 0,
    "review commands must not publish facts");
  reopened.close();
  await runQueueCommand(["ownership-revoke", "--db", db, "--venue", "venue:test",
    "--domain", "venue.example", "--reviewer", "operator", "--reason", "ownership_changed"]);
  const history = await runQueueCommand(["ownership-history", "--db", db, "--venue", "venue:test"]);
  assert.deepEqual(history.map((event) => event.event_type), ["created", "revoked"]);
});

test("ownership-review-next returns the first undecided domain candidate with evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ownership-review-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = join(directory, "store.sqlite");
  const store = new EvidenceStore(db, { clock: () => new Date("2026-09-02T00:00:00Z") });
  store.rememberVenue({ canonical_venue_id: "venue:review", name: "Review Venue",
    source_records: [{ source_record_id: "overture:review", source: "overture_places",
      name: "Review Venue", website: "https://review.example/" }] },
  { checkedAt: "2026-09-01T00:00:00Z", municipality: "Torino" });
  store.close();

  const candidate = await runQueueCommand(["ownership-review-next", "--db", db]);
  assert.equal(candidate.venue_id, "venue:review");
  assert.equal(candidate.candidate_domain, "review.example");
  assert.deepEqual(candidate.candidate_origins, ["source:overture_places"]);
  assert.equal(candidate.sources[0].website, "https://review.example/");
  assert.equal(candidate.queue_remaining, 1);
});
