// CRM records of the online app (PROCESS.md, "CRM views"): contacts, the activity
// log, saved table views, and the per-venue CRM overlay of the lead index. Plain SQL
// over a postgres.js client, so the same code runs on Vercel (web/) and in the tests
// against PGlite. Contacts hold business contact data only (PRIVACY.md, "Venue
// contacts"); deleting one is a hard delete.

import { PIPELINE_STAGES } from "./map-constants.mjs";

const STAGE_CODES = PIPELINE_STAGES.map((stage) => stage.code);

export const CONTACT_ROLES = ["owner", "manager", "chef", "staff", "other"];
export const CONTACT_CHANNELS = ["visit", "phone", "email", "letter"];
export const CONTACT_SOURCES = ["in_person", "business_card", "venue_website", "phone_call", "other"];
export const DELETE_REASONS = { request: "on the person's request", retention: "retention period over",
  mistake: "entered by mistake" };
export const SAVED_VIEW_PAGES = ["leads", "contacts", "activities"];
export const ACTIVITY_KINDS = ["stage", "visit", "card", "letter", "call", "email", "note", "demo"];
export const PAGE_SIZE = 100;

export class CrmInputError extends Error {}

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const choice = (value, allowed, what, { required = false } = {}) => {
  const v = text(value, 40);
  if (!v && !required) return "";
  if (!allowed.includes(v)) throw new CrmInputError(`unknown ${what}: ${v || "(empty)"}`);
  return v;
};

/** Validates a contact form; returns the stored fields. */
export function buildContact(body = {}) {
  const name = text(body.name, 120);
  if (!name) throw new CrmInputError("a contact needs a name");
  const phone = text(body.phone, 40);
  if (phone && !/^\+?[\d\s./()-]{5,}$/.test(phone)) throw new CrmInputError(`not a phone number: ${phone}`);
  const email = text(body.email, 200).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CrmInputError(`not an email address: ${email}`);
  return {
    name, phone, email,
    role: choice(body.role, CONTACT_ROLES, "role"),
    preferred_channel: choice(body.preferred_channel, CONTACT_CHANNELS, "channel"),
    source: choice(body.source, CONTACT_SOURCES, "source of the details", { required: true }),
    notes: text(body.notes, 1000),
  };
}

const CONTACT_COLUMNS = `id, venue_id, venue_name, municipality, province, name, role, phone, email,
  preferred_channel, source, notes, created_by, updated_by, created_at, updated_at`;

/** `venue` is { id, name, municipality, province } from the lead index. */
export async function createContact(sql, venue, body, email) {
  const contact = buildContact(body);
  const [row] = await sql`INSERT INTO contacts (venue_id, venue_name, municipality, province, name, role, phone,
      email, preferred_channel, source, notes, created_by, updated_by)
    VALUES (${venue.id}, ${venue.name}, ${venue.municipality || ""}, ${venue.province || ""}, ${contact.name},
      ${contact.role}, ${contact.phone}, ${contact.email}, ${contact.preferred_channel}, ${contact.source},
      ${contact.notes}, ${email}, ${email})
    RETURNING ${sql.unsafe(CONTACT_COLUMNS)}`;
  return row;
}

export async function updateContact(sql, id, body, email) {
  const contact = buildContact(body);
  const [row] = await sql`UPDATE contacts SET name = ${contact.name}, role = ${contact.role},
      phone = ${contact.phone}, email = ${contact.email}, preferred_channel = ${contact.preferred_channel},
      source = ${contact.source}, notes = ${contact.notes}, updated_by = ${email}, updated_at = now()
    WHERE id = ${contactId(id)} RETURNING ${sql.unsafe(CONTACT_COLUMNS)}`;
  if (!row) throw new CrmInputError("no such contact");
  return row;
}

/**
 * Erases a contact. The venue's activity log keeps only that a contact was removed
 * and why, never who (PRIVACY.md); activities with them keep no link.
 */
export async function deleteContact(sql, id, reason, email) {
  if (!Object.hasOwn(DELETE_REASONS, reason)) throw new CrmInputError(`unknown reason: ${reason}`);
  return sql.begin(async (tx) => {
    const [row] = await tx`DELETE FROM contacts WHERE id = ${contactId(id)} RETURNING venue_id`;
    if (!row) throw new CrmInputError("no such contact");
    await tx`INSERT INTO pipeline_events (venue_id, kind, note, created_by)
      SELECT ${row.venue_id}, 'note', ${`Contact removed: ${DELETE_REASONS[reason]}`}, ${email}
      WHERE EXISTS (SELECT 1 FROM pipeline WHERE venue_id = ${row.venue_id})`;
    return { deleted: true, venue_id: row.venue_id };
  });
}

export async function venueContacts(sql, venueId) {
  return sql`SELECT ${sql.unsafe(CONTACT_COLUMNS)} FROM contacts WHERE venue_id = ${venueId} ORDER BY id`;
}

// Keyset pagination: each sort is a total order ending in id, and the cursor is the
// last row's sort value and id, so a page costs one index range scan however deep.
// The cursor carries the sort key exactly as Postgres returns it as text (a JS Date
// would drop the microseconds of updated_at), cast back for the comparison through
// text: a parameter typed timestamptz is serialized by postgres.js through a Date.
const CONTACT_SORTS = {
  name: { value: "lower(name)", cast: "text", dir: "asc" },
  venue: { value: "lower(venue_name)", cast: "text", dir: "asc" },
  updated: { value: "updated_at", cast: "timestamptz", dir: "desc" },
};

/**
 * Contacts, a page at a time. `q` matches the contact's name, email, phone, or venue;
 * `due` lists only contacts past their retention period, with the reason.
 */
export async function listContacts(sql, { q = "", sort = "name", cursor = "", due = false, limit = PAGE_SIZE } = {}) {
  const order = CONTACT_SORTS[sort] ? sort : "name";
  const { value, cast, dir } = CONTACT_SORTS[order];
  const size = Math.max(1, Math.min(PAGE_SIZE, limit));
  const after = decodeCursor(cursor);
  const like = `%${text(q, 80).toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const comparator = dir === "asc" ? ">" : "<";
  const rows = await sql`
    WITH due AS (${retentionDue(sql)})
    SELECT ${sql.unsafe(CONTACT_COLUMNS)}, due.reason AS due_reason, (${sql.unsafe(value)})::text AS sort_key
    FROM contacts
    LEFT JOIN due ON due.contact_id = contacts.id
    WHERE (${like} = '%%' OR lower(name) LIKE ${like} OR lower(email) LIKE ${like} OR phone LIKE ${like}
        OR lower(venue_name) LIKE ${like} OR lower(municipality) LIKE ${like})
      AND (${!due} OR due.reason IS NOT NULL)
      AND (${!after} OR (${sql.unsafe(value)}, id) ${sql.unsafe(comparator)}
        (${after?.[0] ?? null}::text::${sql.unsafe(cast)}, ${after?.[1] ?? 0}))
    ORDER BY ${sql.unsafe(value)} ${sql.unsafe(dir)}, id ${sql.unsafe(dir)}
    LIMIT ${size + 1}`;
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return {
    items: page.map(({ sort_key, ...row }) => row),
    next: rows.length > size ? encodeCursor([last.sort_key, Number(last.id)]) : "",
  };
}

// Contacts past the retention periods in PRIVACY.md: 12 months after their venue was
// set to lost or do not contact, or 24 months after the last activity (or the contact's
// last change) with a venue that never became a customer.
function retentionDue(sql) {
  return sql`
    SELECT c.id AS contact_id, CASE
        WHEN closed.closed_on < current_date - interval '12 months'
          THEN 'venue ' || replace(p.stage, '_', ' ') || ' since ' || closed.closed_on::text
        ELSE 'no activity since ' || greatest(last.last_on, c.updated_at::date)::text
      END AS reason
    FROM contacts c
    LEFT JOIN pipeline p ON p.venue_id = c.venue_id
    LEFT JOIN LATERAL (SELECT max(happened_on) AS last_on FROM pipeline_events e WHERE e.venue_id = c.venue_id) last ON true
    LEFT JOIN LATERAL (SELECT e.happened_on AS closed_on FROM pipeline_events e
      WHERE e.venue_id = c.venue_id AND e.kind = 'stage' AND e.stage_to = p.stage
        AND p.stage IN ('lost', 'do_not_contact') ORDER BY e.id DESC LIMIT 1) closed ON true
    WHERE closed.closed_on < current_date - interval '12 months'
      OR (coalesce(p.stage, '') <> 'won'
        AND greatest(last.last_on, c.updated_at::date) < current_date - interval '24 months')`;
}

/**
 * The activity log across venues, newest first, a page at a time: every touch and
 * stage change, optionally only some kinds, a date range, or venues in some stages.
 * @param {any} sql
 * @param {{ kinds?: string[], from?: string, to?: string, stages?: string[], venueId?: string,
 *   cursor?: string, limit?: number }} [options]
 */
export async function listActivities(sql, { kinds = [], from = "", to = "", stages = [], venueId = "",
  cursor = "", limit = PAGE_SIZE } = {}) {
  const wantedKinds = kinds.filter((kind) => ACTIVITY_KINDS.includes(kind));
  const wantedStages = stages.filter((stage) => STAGE_CODES.includes(stage));
  const size = Math.max(1, Math.min(PAGE_SIZE, limit));
  const after = decodeCursor(cursor);
  const rows = await sql`
    SELECT e.id, e.venue_id, e.kind, e.stage_from, e.stage_to, e.note, e.happened_on::text AS happened_on,
      e.created_by, e.created_at, e.contact_id, c.name AS contact_name,
      p.venue_name, p.municipality, p.province, p.stage
    FROM pipeline_events e
    JOIN pipeline p ON p.venue_id = e.venue_id
    LEFT JOIN contacts c ON c.id = e.contact_id
    WHERE (${wantedKinds.length === 0} OR e.kind = ANY(${wantedKinds}::text[]))
      AND (${!isDay(from)} OR e.happened_on >= ${isDay(from) ? from : null}::text::date)
      AND (${!isDay(to)} OR e.happened_on <= ${isDay(to) ? to : null}::text::date)
      AND (${wantedStages.length === 0} OR p.stage = ANY(${wantedStages}::text[]))
      AND (${!venueId} OR e.venue_id = ${venueId})
      AND (${!after} OR (e.happened_on, e.id) < (${after?.[0] ?? null}::text::date, ${after?.[1] ?? 0}))
    ORDER BY e.happened_on DESC, e.id DESC
    LIMIT ${size + 1}`;
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return { items: page, next: rows.length > size ? encodeCursor([last.happened_on, Number(last.id)]) : "" };
}

export async function savedViews(sql, page) {
  return sql`SELECT id, page, name, query, created_by, created_at FROM saved_views
    WHERE page = ${choice(page, SAVED_VIEW_PAGES, "page", { required: true })} ORDER BY lower(name)`;
}

/**
 * Saves (or replaces, by name) a view: the page's URL query string.
 * @param {any} sql
 * @param {{ page?: unknown, name?: unknown, query?: unknown }} view
 * @param {string} email
 */
export async function saveView(sql, { page, name, query }, email) {
  const viewName = text(name, 80);
  if (!viewName) throw new CrmInputError("a view needs a name");
  const params = new URLSearchParams(text(query, 2000).replace(/^\?/, ""));
  const [row] = await sql`INSERT INTO saved_views (page, name, query, created_by)
    VALUES (${choice(page, SAVED_VIEW_PAGES, "page", { required: true })}, ${viewName}, ${params.toString()}, ${email})
    ON CONFLICT (page, name) DO UPDATE SET query = excluded.query, created_by = excluded.created_by,
      created_at = now()
    RETURNING id, page, name, query, created_by, created_at`;
  return row;
}

export async function deleteView(sql, id) {
  const [row] = await sql`DELETE FROM saved_views WHERE id = ${contactId(id)} RETURNING id`;
  if (!row) throw new CrmInputError("no such view");
  return { deleted: true };
}

/** A string that changes whenever the CRM overlay could have changed. */
export async function crmStamp(sql) {
  const [row] = await sql`SELECT
      (SELECT coalesce(max(updated_at)::text, '') FROM pipeline) AS pipeline_at,
      (SELECT count(*)::text FROM pipeline) AS pipeline_n,
      (SELECT coalesce(max(id), 0)::text FROM pipeline_events) AS events,
      (SELECT coalesce(max(updated_at)::text, '') FROM contacts) AS contacts_at,
      (SELECT count(*)::text FROM contacts) AS contacts_n`;
  return [row.pipeline_at, row.pipeline_n, row.events, row.contacts_at, row.contacts_n].join("|");
}

/**
 * The lead index's CRM overlay: for every venue in the pipeline or with contacts, its
 * stage, next action, last touch (not stage changes), contact count, and demo state.
 */
export async function crmOverlay(sql) {
  const rows = await sql`
    SELECT coalesce(p.venue_id, c.venue_id) AS venue_id, p.stage, coalesce(p.next_action, '') AS next_action,
      p.next_action_on::text AS next_action_on, coalesce(p.pomovi_status, '') AS pomovi_status,
      t.last_on::text AS last_activity_on, coalesce(c.n, 0)::int AS contacts
    FROM pipeline p
    FULL JOIN (SELECT venue_id, count(*) AS n FROM contacts GROUP BY venue_id) c ON c.venue_id = p.venue_id
    LEFT JOIN (SELECT venue_id, max(happened_on) AS last_on FROM pipeline_events
      WHERE kind <> 'stage' GROUP BY venue_id) t ON t.venue_id = coalesce(p.venue_id, c.venue_id)`;
  const stage = new Map();
  const crm = new Map();
  for (const row of rows) {
    if (row.stage) stage.set(row.venue_id, row.stage);
    crm.set(row.venue_id, { next_action: row.next_action, next_action_on: row.next_action_on ?? "",
      last_activity_on: row.last_activity_on ?? "", contacts: row.contacts, pomovi_status: row.pomovi_status });
  }
  return { stage, crm };
}

function contactId(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw new CrmInputError(`not an id: ${id}`);
  return n;
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && Number.isSafeInteger(value[1])) return value;
  } catch {}
  throw new CrmInputError("invalid cursor");
}
