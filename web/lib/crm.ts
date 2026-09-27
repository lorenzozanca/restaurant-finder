import "server-only";
import { PIPELINE_STAGES } from "@rf/map-constants.mjs";
import type { LeadIndex } from "@rf/national-leads.mjs";
import { db } from "@/lib/db";
import type { BridgedVenue } from "@/lib/pomovi";

// The sales pipeline (PROCESS.md, "Online lead CRM"): one row per venue in it, and
// an event for every stage change and every touch. Rows are never deleted.

export const STAGES = PIPELINE_STAGES.map((stage) => stage.code);
export const EVENT_KINDS = ["visit", "card", "letter", "call", "email", "note"] as const;

export class CrmError extends Error {}

type Update = {
  venue_id?: unknown;
  stage?: unknown;
  next_action?: unknown;
  next_action_on?: unknown;
  lost_reason?: unknown;
  reopen?: unknown;
  event?: { kind?: unknown; note?: unknown; happened_on?: unknown } | null;
};

const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const day = (value: unknown) => {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new CrmError(`not a date: ${v}`);
  return v;
};

export async function pipelineEntry(venueId: string) {
  const sql = db();
  // Dates as text: a date column read into a JS Date shifts with the server's zone.
  const [row] = await sql`SELECT venue_id, venue_name, municipality, province, stage, next_action,
    next_action_on::text, lost_reason, pomovi_venue_id, pomovi_slug, pomovi_status, pomovi_public_url,
    pomovi_wizard_url, pomovi_menu_items, pomovi_checked_at, created_at, updated_at
    FROM pipeline WHERE venue_id = ${venueId}`;
  const events = row ? await sql`SELECT id, kind, stage_from, stage_to, note, happened_on::text, created_by, created_at
    FROM pipeline_events WHERE venue_id = ${venueId} ORDER BY happened_on DESC, id DESC LIMIT 100` : [];
  return { entry: row ?? null, events };
}

/**
 * Adds the venue to the pipeline if needed, then applies a stage change, the next
 * action, and/or one touch. "Do not contact" is left only with `reopen: true`.
 */
export async function updatePipeline(index: LeadIndex, update: Update, email: string) {
  const venueId = text(update.venue_id, 200);
  const i = index.indexOf(venueId);
  if (i < 0) throw new CrmError("unknown venue");
  const stage = update.stage === undefined ? undefined : text(update.stage, 40);
  if (stage !== undefined && !STAGES.includes(stage)) throw new CrmError(`unknown stage: ${stage}`);
  const event = update.event ? {
    kind: text(update.event.kind, 20), note: text(update.event.note, 2000), on: day(update.event.happened_on),
  } : null;
  if (event && !(EVENT_KINDS as readonly string[]).includes(event.kind)) throw new CrmError(`unknown touch: ${event.kind}`);
  const sql = db();
  await sql.begin(async (tx) => {
    const [current] = await tx`SELECT stage FROM pipeline WHERE venue_id = ${venueId} FOR UPDATE`;
    if (current?.stage === "do_not_contact" && update.reopen !== true && (stage !== undefined && stage !== "do_not_contact" || event)) {
      throw new CrmError("this venue is marked do not contact; reopen it explicitly first");
    }
    if (!current) {
      await tx`INSERT INTO pipeline (venue_id, venue_name, municipality, province, stage)
        VALUES (${venueId}, ${index.columns.name[i]}, ${index.columns.municipality[i]}, ${index.columns.province[i]},
          ${stage ?? "shortlisted"})`;
      await tx`INSERT INTO pipeline_events (venue_id, kind, stage_to, created_by)
        VALUES (${venueId}, 'stage', ${stage ?? "shortlisted"}, ${email})`;
    } else if (stage !== undefined && stage !== current.stage) {
      await tx`UPDATE pipeline SET stage = ${stage}, updated_at = now() WHERE venue_id = ${venueId}`;
      await tx`INSERT INTO pipeline_events (venue_id, kind, stage_from, stage_to, created_by)
        VALUES (${venueId}, 'stage', ${current.stage}, ${stage}, ${email})`;
    }
    if (update.next_action !== undefined || update.next_action_on !== undefined || update.lost_reason !== undefined) {
      const [row] = await tx`SELECT next_action, next_action_on::text, lost_reason FROM pipeline WHERE venue_id = ${venueId}`;
      await tx`UPDATE pipeline SET
        next_action = ${update.next_action === undefined ? row.next_action : text(update.next_action, 500)},
        next_action_on = ${update.next_action_on === undefined ? row.next_action_on : day(update.next_action_on)},
        lost_reason = ${update.lost_reason === undefined ? row.lost_reason : text(update.lost_reason, 500)},
        updated_at = now() WHERE venue_id = ${venueId}`;
    }
    if (event) {
      await tx`INSERT INTO pipeline_events (venue_id, kind, note, happened_on, created_by)
        VALUES (${venueId}, ${event.kind}, ${event.note}, coalesce(${event.on}::date, current_date), ${email})`;
      await tx`UPDATE pipeline SET updated_at = now() WHERE venue_id = ${venueId}`;
    }
  });
  return pipelineEntry(venueId);
}

/** The pipeline as a work list: next actions first, by date. */
export async function pipelineList(index: LeadIndex, stages: string[]) {
  const sql = db();
  const rows = stages.length
    ? await sql`SELECT venue_id, venue_name, municipality, province, stage, next_action, next_action_on::text,
        pomovi_status, updated_at FROM pipeline WHERE stage = ANY(${stages}::text[])
        ORDER BY next_action_on ASC NULLS LAST, updated_at DESC LIMIT 500`
    : await sql`SELECT venue_id, venue_name, municipality, province, stage, next_action, next_action_on::text,
        pomovi_status, updated_at FROM pipeline
        ORDER BY next_action_on ASC NULLS LAST, updated_at DESC LIMIT 500`;
  return rows.map((row) => ({ ...row, i: index.indexOf(row.venue_id) }));
}

/** Records what Pomovi says about a venue's demo; moves the stage forward when it can. */
export async function recordPomovi(venue: BridgedVenue, email: string) {
  const sql = db();
  await sql.begin(async (tx) => {
    const [current] = await tx`SELECT stage FROM pipeline WHERE venue_id = ${venue.source_ref} FOR UPDATE`;
    if (!current) return;
    await tx`UPDATE pipeline SET pomovi_venue_id = ${venue.pomovi_venue_id}, pomovi_slug = ${venue.slug},
      pomovi_status = ${venue.status}, pomovi_public_url = ${venue.public_url ?? null},
      pomovi_wizard_url = coalesce(${venue.wizard_url ?? null}, pomovi_wizard_url),
      pomovi_menu_items = ${venue.menu_items ?? null}, pomovi_checked_at = now(), updated_at = now()
      WHERE venue_id = ${venue.source_ref}`;
    let next: string | null = null;
    if (venue.status === "active" && !["won", "do_not_contact"].includes(current.stage)) next = "won";
    else if ((venue.menu_items ?? 0) > 0 && ["shortlisted", "demo_requested"].includes(current.stage)) next = "demo_ready";
    if (next) {
      await tx`UPDATE pipeline SET stage = ${next} WHERE venue_id = ${venue.source_ref}`;
      await tx`INSERT INTO pipeline_events (venue_id, kind, stage_from, stage_to, note, created_by)
        VALUES (${venue.source_ref}, 'stage', ${current.stage}, ${next},
          ${next === "won" ? "Pomovi: the venue is active" : "Pomovi: the demo has a menu"}, ${email})`;
    }
  });
}
