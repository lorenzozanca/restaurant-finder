import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  buildContact, createContact, crmOverlay, crmStamp, CrmInputError, deleteContact, deleteView, listActivities,
  listContacts, savedViews, saveView, updateContact, venueContacts,
} from "./crm-records.mjs";
import { connectOnline, migrate } from "./online-db.mjs";

// A real Postgres (PGlite over its socket server), so the SQL runs as it does on Neon.
async function crmDatabase(t) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const sql = connectOnline(`postgres://postgres:postgres@127.0.0.1:${server.server.address().port}/postgres`);
  t.after(async () => {
    await sql.end();
    await server.stop();
    await db.close();
  });
  await migrate(sql);
  return sql;
}

const me = "me@example.com";
const venue = (id, name, municipality = "Treviso") => ({ id, name, municipality, province: "TV" });
const card = { source: "business_card" };

test("contact validation keeps business fields and refuses bad input", () => {
  assert.deepEqual(buildContact({ name: "  Anna Rossi ", role: "owner", phone: "+39 0422 123456",
    email: "Anna@Trattoria.IT", preferred_channel: "visit", source: "in_person", notes: "Mornings" }),
  { name: "Anna Rossi", phone: "+39 0422 123456", email: "anna@trattoria.it", role: "owner",
    preferred_channel: "visit", source: "in_person", notes: "Mornings" });
  assert.throws(() => buildContact({ source: "in_person" }), /needs a name/);
  assert.throws(() => buildContact({ name: "A" }), /source of the details/, "the source is required");
  assert.throws(() => buildContact({ name: "A", source: "linkedin_scrape" }), CrmInputError);
  assert.throws(() => buildContact({ name: "A", source: "other", email: "not-an-email" }), /email/);
  assert.throws(() => buildContact({ name: "A", source: "other", phone: "call me" }), /phone/);
  assert.throws(() => buildContact({ name: "A", source: "other", role: "cousin" }), /role/);
});

test("contacts page by name, venue, and last change without losing or repeating one", async (t) => {
  const sql = await crmDatabase(t);
  const names = ["Bruno", "anna", "Carla", "Dario", "Elena", "Àlvaro"];
  for (const [k, name] of names.entries()) {
    await createContact(sql, venue(`venue:${k}`, `Trattoria ${String.fromCharCode(90 - k)}`), { name, ...card }, me);
  }
  // Same last-change time for several rows: the id must break the tie.
  await sql`UPDATE contacts SET updated_at = '2026-09-28 10:00:00.123456+00' WHERE id <= 4`;
  for (const sort of ["name", "venue", "updated"]) {
    const seen = [];
    let cursor = "";
    do {
      const page = await listContacts(sql, { sort, cursor, limit: 2 });
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((row) => row.name));
      cursor = page.next;
    } while (cursor);
    assert.equal(seen.length, names.length, `${sort}: every contact once`);
    assert.equal(new Set(seen).size, names.length);
    if (sort === "name") assert.deepEqual(seen.slice(0, 3), ["anna", "Bruno", "Carla"], "case-insensitive");
  }
  assert.deepEqual((await listContacts(sql, { q: "trattoria z" })).items.map((row) => row.name), ["Bruno"]);
  assert.deepEqual((await listContacts(sql, { q: "50%" })).items, [], "LIKE wildcards are literal");
  await assert.rejects(listContacts(sql, { cursor: "garbage" }), /invalid cursor/);

  const [first] = await venueContacts(sql, "venue:0");
  const changed = await updateContact(sql, first.id, { name: "Bruno Neri", role: "chef", source: "in_person" }, "you@example.com");
  assert.equal(changed.role, "chef");
  assert.equal(changed.updated_by, "you@example.com");
  assert.equal(changed.created_by, me);
  await assert.rejects(updateContact(sql, 9999, { name: "X", ...card }, me), /no such contact/);
});

test("erasing a contact keeps the activity, drops the link, and logs no personal detail", async (t) => {
  const sql = await crmDatabase(t);
  await sql`INSERT INTO pipeline (venue_id, venue_name, stage) VALUES ('venue:a', 'Da Anna', 'contacted')`;
  const anna = await createContact(sql, venue("venue:a", "Da Anna"), { name: "Anna Rossi", ...card }, me);
  await sql`INSERT INTO pipeline_events (venue_id, kind, note, contact_id, created_by)
    VALUES ('venue:a', 'visit', 'Menu discussed', ${anna.id}, ${me})`;
  const loner = await createContact(sql, venue("venue:b", "Bar B"), { name: "Luca", ...card }, me);

  await assert.rejects(deleteContact(sql, anna.id, "because", me), /unknown reason/);
  assert.deepEqual(await deleteContact(sql, anna.id, "request", me), { deleted: true, venue_id: "venue:a" });
  const events = await sql`SELECT kind, note, contact_id FROM pipeline_events ORDER BY id`;
  assert.deepEqual(events.map((e) => [e.kind, e.contact_id]), [["visit", null], ["note", null]]);
  assert.equal(events[1].note, "Contact removed: on the person's request");
  assert.ok(!JSON.stringify(events).includes("Anna Rossi"));
  await deleteContact(sql, loner.id, "mistake", me);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pipeline_events`)[0].n, 2,
    "a venue outside the pipeline gets no log entry");
  assert.equal((await sql`SELECT count(*)::int AS n FROM contacts`)[0].n, 0);
  await assert.rejects(deleteContact(sql, anna.id, "request", me), /no such contact/);
});

test("contacts past their retention period are listed with the reason", async (t) => {
  const sql = await crmDatabase(t);
  const add = async (id, stage, { closedMonthsAgo, lastTouchMonthsAgo, contactMonthsAgo = 30 } = {}) => {
    if (stage) {
      await sql`INSERT INTO pipeline (venue_id, venue_name, stage) VALUES (${id}, ${id}, ${stage})`;
      if (closedMonthsAgo !== undefined) {
        await sql`INSERT INTO pipeline_events (venue_id, kind, stage_to, happened_on, created_by)
          VALUES (${id}, 'stage', ${stage}, current_date - ${closedMonthsAgo} * interval '1 month', ${me})`;
      }
      if (lastTouchMonthsAgo !== undefined) {
        await sql`INSERT INTO pipeline_events (venue_id, kind, happened_on, created_by)
          VALUES (${id}, 'visit', current_date - ${lastTouchMonthsAgo} * interval '1 month', ${me})`;
      }
    }
    const contact = await createContact(sql, venue(id, id), { name: `Contact ${id}`, ...card }, me);
    await sql`UPDATE contacts SET updated_at = now() - ${contactMonthsAgo} * interval '1 month' WHERE id = ${contact.id}`;
  };
  await add("lost-old", "lost", { closedMonthsAgo: 13 });
  await add("lost-recent", "lost", { closedMonthsAgo: 2, contactMonthsAgo: 2 });
  await add("quiet", "contacted", { lastTouchMonthsAgo: 25 });
  await add("active", "contacted", { lastTouchMonthsAgo: 1 });
  await add("customer", "won", { lastTouchMonthsAgo: 30 });
  await add("no-pipeline", null);
  await add("fresh", null, { contactMonthsAgo: 1 });
  const due = (await listContacts(sql, { due: true })).items;
  assert.deepEqual(due.map((row) => row.venue_id).sort(), ["lost-old", "no-pipeline", "quiet"]);
  assert.match(due.find((row) => row.venue_id === "lost-old").due_reason, /^venue lost since \d{4}-\d{2}-\d{2}$/);
  assert.match(due.find((row) => row.venue_id === "quiet").due_reason, /^no activity since /);
  assert.equal((await listContacts(sql)).items.length, 7);
});

test("the activity log filters by kind, dates, stage, and venue, newest first, in pages", async (t) => {
  const sql = await crmDatabase(t);
  await sql`INSERT INTO pipeline (venue_id, venue_name, municipality, stage) VALUES
    ('venue:a', 'Da Anna', 'Treviso', 'contacted'), ('venue:b', 'Bar B', 'Padova', 'won')`;
  const anna = await createContact(sql, venue("venue:a", "Da Anna"), { name: "Anna", ...card }, me);
  const rows = [["venue:a", "visit", "2026-09-01"], ["venue:a", "call", "2026-09-10"], ["venue:b", "letter", "2026-09-10"],
    ["venue:b", "stage", "2026-09-15"], ["venue:a", "note", "2026-09-20"]];
  for (const [venueId, kind, day] of rows) {
    await sql`INSERT INTO pipeline_events (venue_id, kind, happened_on, contact_id, created_by)
      VALUES (${venueId}, ${kind}, ${day}, ${kind === "call" ? anna.id : null}, ${me})`;
  }
  const all = await listActivities(sql);
  assert.deepEqual(all.items.map((row) => row.kind), ["note", "stage", "letter", "call", "visit"]);
  assert.equal(all.items.find((row) => row.kind === "call").contact_name, "Anna");
  assert.equal(all.items[0].venue_name, "Da Anna");
  assert.deepEqual((await listActivities(sql, { kinds: ["call", "letter", "bogus"] })).items.length, 2);
  assert.deepEqual((await listActivities(sql, { from: "2026-09-10", to: "2026-09-15" })).items.length, 3);
  assert.deepEqual((await listActivities(sql, { stages: ["won"] })).items.map((row) => row.kind), ["stage", "letter"]);
  assert.deepEqual((await listActivities(sql, { venueId: "venue:a" })).items.length, 3);
  const seen = [];
  let cursor = "";
  do {
    const page = await listActivities(sql, { cursor, limit: 2 });
    seen.push(...page.items.map((row) => row.id));
    cursor = page.next;
  } while (cursor);
  assert.deepEqual(seen, all.items.map((row) => row.id), "pages join up to the full log");
});

test("saved views are replaced by name and scoped to their page", async (t) => {
  const sql = await crmDatabase(t);
  await saveView(sql, { page: "leads", name: "Treviso verified", query: "?prov=TV&status=verified" }, me);
  await saveView(sql, { page: "leads", name: "Treviso verified", query: "prov=TV&status=verified&phone=1" }, me);
  await saveView(sql, { page: "contacts", name: "Owners", query: "q=" }, me);
  const leads = await savedViews(sql, "leads");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].query, "prov=TV&status=verified&phone=1");
  await assert.rejects(saveView(sql, { page: "leads", name: " ", query: "" }, me), /needs a name/);
  await assert.rejects(savedViews(sql, "secrets"), /unknown page/);
  await deleteView(sql, leads[0].id);
  assert.equal((await savedViews(sql, "leads")).length, 0);
});

test("the CRM overlay covers pipeline venues and venues with only contacts, and its stamp moves", async (t) => {
  const sql = await crmDatabase(t);
  const empty = await crmStamp(sql);
  await sql`INSERT INTO pipeline (venue_id, venue_name, stage, next_action, next_action_on, pomovi_status)
    VALUES ('venue:a', 'Da Anna', 'follow_up', 'Bring the demo', '2026-10-01', 'prospect')`;
  await sql`INSERT INTO pipeline_events (venue_id, kind, happened_on, created_by) VALUES
    ('venue:a', 'visit', '2026-09-20', ${me}), ('venue:a', 'stage', '2026-09-25', ${me})`;
  const afterPipeline = await crmStamp(sql);
  assert.notEqual(afterPipeline, empty);
  await createContact(sql, venue("venue:a", "Da Anna"), { name: "Anna", ...card }, me);
  await createContact(sql, venue("venue:b", "Bar B"), { name: "Luca", ...card }, me);
  assert.notEqual(await crmStamp(sql), afterPipeline);
  const { stage, crm } = await crmOverlay(sql);
  assert.deepEqual([...stage], [["venue:a", "follow_up"]]);
  assert.deepEqual(crm.get("venue:a"), { next_action: "Bring the demo", next_action_on: "2026-10-01",
    last_activity_on: "2026-09-20", contacts: 1, pomovi_status: "prospect" }, "stage changes are not touches");
  assert.deepEqual(crm.get("venue:b"), { next_action: "", next_action_on: "", last_activity_on: "", contacts: 1,
    pomovi_status: "" });
});
