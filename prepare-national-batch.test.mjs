import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assessedVenueIds, nextBatch } from "./prepare-national-batch.mjs";

test("next batch skips venues already assessed in the national store", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "national-batch-")), "store.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE candidate_assessments (venue_id TEXT, candidate_url TEXT)");
  db.prepare("INSERT INTO candidate_assessments VALUES (?, ?)").run("venue:a", "https://a.example/");
  db.prepare("INSERT INTO candidate_assessments VALUES (?, ?)").run("venue:a", "https://a2.example/");
  db.close();

  const done = assessedVenueIds(dbPath);
  assert.deepEqual([...done], ["venue:a"]);
  const rows = ["venue:a", "venue:b", "venue:c"].map((venue_id) => ({ venue_id }));
  const batch = nextBatch(rows, done, 10).map((row) => row.venue_id).sort();
  assert.deepEqual(batch, ["venue:b", "venue:c"]);
});
