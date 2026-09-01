import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { replayPublisherOwnership } from "./replay-publisher-ownership.mjs";

test("offline replay retains adjudicated publishers and rejects unseen directories", () => {
  const directory = mkdtempSync(join(tmpdir(), "publisher-replay-"));
  const dbPath = join(directory, "pilot.sqlite");
  const selectionPath = join(directory, "selection.json");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE venues (venue_id TEXT PRIMARY KEY, display_name TEXT);
    CREATE TABLE facts (venue_id TEXT, kind TEXT, decision_status TEXT, payload_json TEXT);`);
  db.prepare("INSERT INTO venues VALUES (?, ?)").run("venue:true", "True Venue");
  db.prepare("INSERT INTO venues VALUES (?, ?)").run("venue:false", "False Venue");
  const insertFact = db.prepare("INSERT INTO facts VALUES (?, ?, ?, ?)");
  insertFact.run("venue:true", "website", "accepted", JSON.stringify({
    website_provenance: { source_url: "https://true-venue.example/menu" },
  }));
  insertFact.run("venue:false", "website", "accepted", JSON.stringify({
    website_provenance: { source_url: "https://true-venue.unknown-directory.invalid/menu" },
  }));
  db.close();
  const review = {
    official_website_status: "accepted",
    official_website_url: "https://true-venue.example/",
    evidence_urls: ["https://registry.example/true-venue"],
    reviewed_at: "2026-09-01T12:00:00Z",
    reviewer: "Independent reviewer",
  };
  writeFileSync(selectionPath, JSON.stringify({ candidates: [
    { venue_id: "venue:true", review },
    { venue_id: "venue:false", review: { ...review,
      official_website_url: "https://actual-false-venue.example/" } },
  ] }));
  const result = replayPublisherOwnership({ dbPath, selectionPath, pilot: "fixture" });
  assert.equal(result.true_retained, 1);
  assert.equal(result.false_rejected, 1);
  assert.equal(result.passed, true);
});
