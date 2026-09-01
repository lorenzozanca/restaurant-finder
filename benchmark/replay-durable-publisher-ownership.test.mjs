import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../lib/evidence-store.mjs";
import { replayDurablePublisherOwnership } from "./replay-durable-publisher-ownership.mjs";

test("replay imports reviews into a copy and leaves the source database untouched", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "durable-publisher-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source.sqlite");
  const copy = join(directory, "copy.sqlite");
  const selectionPath = join(directory, "selection.json");
  const store = new EvidenceStore(source, { clock: () => new Date("2026-09-01T00:00:00Z") });
  const venue = { canonical_venue_id: "venue:true", name: "True Venue", source_records: [] };
  store.recordEnrichment(venue, { website: "https://true.example/",
    website_decision: { status: "accepted", final_url: "https://true.example/" }, resources: [] },
  { checkedAt: "2026-09-01T00:00:00Z" });
  store.close();
  const sourceBytes = readFileSync(source);
  writeFileSync(selectionPath, JSON.stringify({ selection_id: "fixture", candidates: [{
    venue_id: "venue:true", review: { official_website_status: "accepted",
      official_website_url: "https://true.example/", evidence_urls: ["https://true.example/contact"],
      reviewer: "reviewer", reviewed_at: "2026-09-01T00:00:00Z" },
  }] }));
  const result = replayDurablePublisherOwnership({ sourceDbPath: source, copyDbPath: copy,
    selectionPath, pilot: "fixture" });
  assert.equal(result.passed, true);
  assert.equal(result.true_retained, 1);
  assert.deepEqual(readFileSync(source), sourceBytes);
});
