import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { connectOnline, migrate } from "./online-db.mjs";
import { buildMapSnapshot } from "./map-snapshot.mjs";
import { leadFixtureStore } from "./national-leads.fixture.mjs";
import { LeadIndex } from "./national-leads.mjs";
import { authorizePomovi, catalogueQuery, searchPomoviCatalogue, signupNotification, recordPomoviSignup } from "./pomovi-signups.mjs";

function snapshot(t) {
  const directory = mkdtempSync(join(tmpdir(), "pomovi-catalogue-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "venues.sqlite");
  leadFixtureStore(path);
  return buildMapSnapshot(path, { at: "2026-09-21T00:00:00Z" });
}

async function database(t) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const sql = connectOnline(`postgres://postgres:postgres@127.0.0.1:${server.server.address().port}/postgres`);
  t.after(async () => { await sql.end(); await server.stop(); await db.close(); });
  await migrate(sql);
  return sql;
}
const notification = (stage = "demo_requested", signup_id = 1) => ({ ref: "venue:ok", signup_id, stage });

test("inbound authentication fails closed and ignores operator cookies", async () => {
  const request = (authorization) => new Request("https://crm.example/api/pomovi/search?q=mario", {
    headers: { ...(authorization ? { authorization } : {}), cookie: "authjs.session-token=forged" },
  });
  for (const absent of ["", "   "]) assert.equal(authorizePomovi(request("Bearer right"), absent).status, 404);
  for (const wrong of [undefined, "right", "Basic right", "Bearer wrong", "Bearer right-extra"]) {
    const response = authorizePomovi(request(wrong), "right");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.ok(!(await response.text()).includes("right"));
  }
  assert.equal(authorizePomovi(request("Bearer right"), "right"), null);
  assert.equal(authorizePomovi(request("bearer right"), "right"), null);
});

test("catalogue input requires three characters and bounds queries before index loading", () => {
  for (const q of ["", "ab", "  à  ", "x".repeat(81)]) assert.throws(() => catalogueQuery({ q }));
  assert.throws(() => catalogueQuery({ q: "caffe", municipality: "x".repeat(101) }));
  assert.throws(() => catalogueQuery({ ref: "venue:ok", q: "mario" }));
  assert.throws(() => catalogueQuery({ ref: "venue:ok", municipality: "Roma" }));
  assert.throws(() => catalogueQuery({ ref: " venue:ok" }));
  assert.deepEqual(catalogueQuery({ q: "  CAFFÈ  ", municipality: "VÈNEZIA" }), { q: "caffe", municipality: "venezia", ref: "" });
});

test("prefix and exact town search ignore accents/case, return only bounded public identity fields", (t) => {
  const index = new LeadIndex(snapshot(t));
  const find = (query) => searchPomoviCatalogue(index, catalogueQuery(query));
  assert.deepEqual(find({ q: "CAFFE" }).results.map(r => r.ref), ["venue:dir"]);
  assert.deepEqual(find({ q: "mario" }).results.map(r => r.ref), ["venue:ok"], "a word of the name, as it's known in town");
  assert.deepEqual(find({ q: "ario" }).results, [], "word starts only, not an arbitrary substring");
  assert.deepEqual(find({ q: "venezia" }).results, [], "not a town search");
  assert.equal(find({ q: "da mar", municipality: "VÈNEZIA" }).results[0].ref, "venue:ok");
  assert.deepEqual(find({ q: "da mar", municipality: "Roma" }).results, []);
  const result = find({ ref: "venue:ok" });
  assert.deepEqual(Object.keys(result.results[0]).sort(), ["address", "municipality", "name", "province", "ref", "region", "website", "website_status"]);
  assert.equal(result.results[0].website, "https://mario.example/");
  assert.equal(result.results[0].website_status, "verified");
  assert.match(result.attribution, /Overture/);
  assert.match(result.attribution, /© OpenStreetMap contributors/);
  assert.deepEqual(find({ ref: "unknown" }).results, []);
});

test("search caps common prefixes at ten in stable name order, without changing the snapshot", (t) => {
  const source = snapshot(t);
  for (const [key, values] of Object.entries(source.columns)) {
    source.columns[key] = Array.from({ length: 30 }, (_, i) => key === "id" ? `venue:${i}`
      : key === "name" ? `Caffè ${String(29-i).padStart(2, "0")}` : values[0]);
  }
  source.count = 30;
  const original = structuredClone(source);
  const index = new LeadIndex(source);
  const result = searchPomoviCatalogue(index, catalogueQuery({ q: "caffe" }));
  assert.equal(result.results.length, 10);
  assert.deepEqual(result.results.map(r => r.name), Array.from({ length: 10 }, (_, i) => `Caffè ${String(i).padStart(2, "0")}`));
  assert.deepEqual(source, original, "querying never mutates snapshot facts");
});

test("website suggestions preserve verified/candidate distinctions and suppress rejected/directory links", (t) => {
  const index = new LeadIndex(snapshot(t));
  const find = (ref) => searchPomoviCatalogue(index, catalogueQuery({ ref })).results[0];
  for (const ref of ["venue:new", "venue:amb", "venue:dead"]) assert.equal(find(ref).website_status, "candidate");
  for (const ref of ["venue:no", "venue:dir", "venue:none"]) {
    assert.equal(find(ref).website, null); assert.equal(find(ref).website_status, "none");
  }
  const i = index.indexOf("venue:new");
  for (const bad of ["javascript:alert(1)", "https://user:secret@example.com", "file:///etc/passwd"]) {
    index.columns.candidate_url[i] = bad;
    assert.equal(find("venue:new").website, null);
  }
});

test("pending manual reviews use the approved URL, never mark a different stale candidate verified", (t) => {
  const index = new LeadIndex(snapshot(t));
  const find = () => searchPomoviCatalogue(index, catalogueQuery({ ref: "venue:new" })).results[0];
  index.applyOverlay({ status: new Map([["venue:new", "verified"]]), key: "pending-without-url" });
  assert.equal(find().website_status, "candidate");
  index.applyOverlay({ status: new Map([["venue:new", "verified"]]),
    websites: new Map([["venue:new", "https://approved.example/official"]]), key: "approved" });
  assert.equal(find().website, "https://approved.example/official");
  assert.equal(find().website_status, "verified");
  index.applyOverlay();
  assert.equal(find().website, "https://new.example/");
  assert.equal(find().website_status, "candidate");
});

test("notifications accept only their minimal contract and never accept automatic won or contact data", () => {
  assert.deepEqual(signupNotification(notification()), notification());
  for (const input of [null, [], {}, { ...notification(), signup_id: "1" }, { ...notification(), signup_id: 0 },
    { ...notification(), signup_id: 1.5 }, { ...notification(), stage: "won" }, { ...notification(), ref: "" },
    { ...notification(), contactName: "Private person" }, { ...notification(), email: "person@example.com" }]) {
    assert.throws(() => signupNotification(input));
  }
});

test("a signup creates the lead and system note, advances to ready, and leaves another venue untouched", async (t) => {
  const sql = await database(t), index = new LeadIndex(snapshot(t));
  await sql`INSERT INTO pipeline (venue_id, venue_name, stage, next_action) VALUES ('venue:amb', 'Other', 'contacted', 'Visit')`;
  assert.deepEqual(await recordPomoviSignup(sql, index, notification()), { stage: "demo_requested", duplicate: false });
  assert.deepEqual(await recordPomoviSignup(sql, index, notification("demo_ready")), { stage: "demo_ready", duplicate: false });
  const rows = await sql`SELECT venue_id, stage, next_action FROM pipeline ORDER BY venue_id`;
  assert.deepEqual(rows.map(r => [r.venue_id, r.stage, r.next_action]), [["venue:amb", "contacted", "Visit"], ["venue:ok", "demo_ready", ""]]);
  const events = await sql`SELECT kind, stage_from, stage_to, note, created_by FROM pipeline_events ORDER BY id`;
  assert.deepEqual(events.map(e => e.kind), ["stage", "note", "stage", "note"]);
  assert.deepEqual(events.filter(e => e.kind === "note").map(e => e.note), ["self-signup:1:demo_requested", "self-signup:1:demo_ready"]);
  assert.ok(events.every(e => e.created_by === "pomovi:self-signup"));
  assert.equal((await sql`SELECT count(*)::int AS n FROM manual_reviews`)[0].n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM contacts`)[0].n, 0);
});

test("racing retries and late notifications do not duplicate events or regress a ready demo", async (t) => {
  const sql = await database(t), index = new LeadIndex(snapshot(t));
  const results = await Promise.all(Array.from({ length: 3 }, () => recordPomoviSignup(sql, index, notification("demo_ready"))));
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  await recordPomoviSignup(sql, index, notification());
  await recordPomoviSignup(sql, index, notification());
  assert.equal((await sql`SELECT stage FROM pipeline`)[0].stage, "demo_ready");
  assert.deepEqual((await sql`SELECT kind FROM pipeline_events ORDER BY id`).map(e => e.kind), ["stage", "note", "note"]);
  // A genuinely new signup at the same restaurant gets its own note, not another lead.
  await recordPomoviSignup(sql, index, notification("demo_requested", 2));
  assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline`)[0].n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline_events WHERE kind='note'`)[0].n, 3);
});

test("operator sales stages stay manual, and do-not-contact refuses all automatic writes", async (t) => {
  const sql = await database(t), index = new LeadIndex(snapshot(t));
  for (const stage of ["contacted", "follow_up", "won", "lost", "do_not_contact"]) {
    await sql`DELETE FROM pipeline_events`; await sql`DELETE FROM pipeline`;
    await sql`INSERT INTO pipeline (venue_id, venue_name, stage, next_action) VALUES ('venue:ok', 'Mario', ${stage}, 'Keep this')`;
    if (stage === "do_not_contact") {
      await assert.rejects(recordPomoviSignup(sql, index, notification()), error => error.status === 409);
      assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline_events`)[0].n, 0);
    } else {
      await recordPomoviSignup(sql, index, notification());
      await recordPomoviSignup(sql, index, notification("demo_ready"));
    }
    assert.deepEqual((await sql`SELECT stage, next_action FROM pipeline`).map(r => [r.stage, r.next_action]), [[stage, "Keep this"]]);
  }
});

test("bad/unknown notifications write nothing and note failures roll back the whole delivery", async (t) => {
  const sql = await database(t), index = new LeadIndex(snapshot(t));
  await assert.rejects(recordPomoviSignup(sql, index, { ...notification(), ref: "unknown" }), error => error.status === 404);
  await assert.rejects(recordPomoviSignup(sql, index, { ...notification(), stage: "won" }));
  await sql.unsafe(`CREATE FUNCTION reject_note() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.kind = 'note' THEN RAISE EXCEPTION 'note unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_note BEFORE INSERT ON pipeline_events FOR EACH ROW EXECUTE FUNCTION reject_note();`);
  await assert.rejects(recordPomoviSignup(sql, index, notification()), /note unavailable/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline`)[0].n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline_events`)[0].n, 0);
  await sql.unsafe('DROP TRIGGER reject_note ON pipeline_events');
  assert.deepEqual(await recordPomoviSignup(sql, index, notification()), { stage: "demo_requested", duplicate: false });
});
