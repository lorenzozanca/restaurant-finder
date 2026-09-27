import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { snapshotPathFor } from "./map-snapshot.mjs";
import { leadFixtureStore } from "./national-leads.fixture.mjs";
import { connectOnline, migrate } from "./online-db.mjs";
import { syncOnline } from "./online-sync.mjs";
import { venueReview } from "./review-queue.mjs";

// A real Postgres (PGlite over its socket server), so the SQL the sync sends to Neon
// is exercised as written.
async function onlineDatabase(t) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const port = server.server.address().port;
  const sql = connectOnline(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  t.after(async () => {
    await sql.end();
    await server.stop();
    await db.close();
  });
  return sql;
}

test("sync applies online decisions to the store, then pushes the snapshot, details, and a CRM backup", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "online-sync-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "national.sqlite");
  leadFixtureStore(dbPath);
  const sql = await onlineDatabase(t);
  assert.deepEqual(await migrate(sql), ["0001_online_crm.sql"]);
  assert.deepEqual(await migrate(sql), [], "migrations run once");

  const body = { venue_id: "venue:amb", candidate_domain: "amb.example", decision: "approve",
    website_url: "https://amb.example/", evidence_urls: ["https://amb.example/contatti"], reviewer: "Lorenzo" };
  await sql`INSERT INTO manual_reviews (venue_id, candidate_domain, decision, body, decided_by, created_at)
    VALUES ('venue:amb', 'amb.example', 'approve', ${sql.json(body)}, 'me@example.com', '2026-09-27T09:00:00Z')`;
  await sql`INSERT INTO manual_reviews (venue_id, candidate_domain, decision, body, decided_by)
    VALUES ('venue:new', 'elsewhere.example', 'approve',
      ${sql.json({ ...body, venue_id: "venue:new", candidate_domain: "elsewhere.example" })}, 'me@example.com')`;
  await sql`INSERT INTO pipeline (venue_id, venue_name, stage) VALUES ('venue:amb', 'Trattoria Amb', 'contacted')`;
  await sql`INSERT INTO pipeline_events (venue_id, kind, note, created_by)
    VALUES ('venue:amb', 'visit', 'Left the card', 'me@example.com')`;

  const backupDir = join(directory, "backups");
  const first = await syncOnline({ sql, dbPath, backupDir, now: () => new Date("2026-09-27T10:00:00Z") });
  assert.deepEqual(first.reviews, { pending: 2, applied: 1, failed: 1 });
  const review = venueReview(dbPath, "venue:amb", { at: "2026-09-28T00:00:00Z" });
  const manual = review.attestations.find((a) => a.method === "manual_first_party_review");
  assert.equal(manual.status, "verified");
  assert.equal(manual.reviewed_at, "2026-09-27T09:00:00.000Z", "the online decision time is kept");
  const [failed] = await sql`SELECT apply_error FROM manual_reviews WHERE venue_id = 'venue:new'`;
  assert.match(failed.apply_error, /not a stored candidate/);

  assert.equal(first.snapshot.uploaded, true);
  const [row] = await sql`SELECT venue_count, payload FROM map_snapshots`;
  const online = JSON.parse(gunzipSync(row.payload));
  assert.equal(row.venue_count, 7);
  assert.equal(online.columns.status[online.columns.id.indexOf("venue:amb")], 0, "the snapshot has the new verification");
  assert.ok(existsSync(snapshotPathFor(dbPath)));

  assert.equal(first.details.total, 6, "every venue with a website has a detail");
  const [detail] = await sql`SELECT detail FROM venue_details WHERE venue_id = 'venue:dead'`;
  assert.equal(detail.detail.candidates[0].domain, "dead.example");
  assert.deepEqual(detail.detail.assessments[0].evidence.slice(-1), ["failure_ENOTFOUND"]);

  const backups = readdirSync(backupDir);
  assert.equal(backups.length, 1);
  const saved = JSON.parse(readFileSync(join(backupDir, backups[0]), "utf8"));
  assert.equal(saved.tables.pipeline[0].stage, "contacted");
  assert.equal(saved.tables.pipeline_events[0].note, "Left the card");
  assert.equal(saved.tables.manual_reviews.length, 2);

  const second = await syncOnline({ sql, dbPath, backupDir, now: () => new Date("2026-09-27T11:00:00Z") });
  assert.deepEqual(second.reviews, { pending: 0, applied: 0, failed: 0 });
  assert.equal(second.snapshot.uploaded, false, "an unchanged store is not uploaded again");
  assert.equal(second.details.upserted, 0, "unchanged details are not sent again");
  assert.equal((await sql`SELECT count(*)::int AS n FROM sync_runs`)[0].n, 2);
});
