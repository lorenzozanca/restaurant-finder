import "server-only";
import { gunzipSync } from "node:zlib";
import { LeadIndex } from "@rf/national-leads.mjs";
import { registrableDomain } from "@rf/publisher-ownership.mjs";
import { db } from "@/lib/db";

// The lead index the map API answers from: the newest snapshot the laptop uploaded
// (sync-online.mjs), plus an overlay of what changed online since: manual decisions
// not yet in a snapshot, and pipeline stages. Held in memory per server instance and
// re-checked against the database at most every CHECK_MS.

const CHECK_MS = 5_000;

type State = {
  index: LeadIndex | null;
  snapshotVersion: string;
  builtAt: string;
  overlayKey: string;
  checkedAt: number;
  pending: Promise<LeadIndex> | null;
};
const globalForLeads = globalThis as unknown as { rfLeads?: State };
const state: State = (globalForLeads.rfLeads ??= {
  index: null, snapshotVersion: "", builtAt: "", overlayKey: "", checkedAt: 0, pending: null,
});

export class NoSnapshotError extends Error {}

export function leadIndex(): Promise<LeadIndex> {
  if (state.index && Date.now() - state.checkedAt < CHECK_MS) return Promise.resolve(state.index);
  state.pending ??= refresh().finally(() => { state.pending = null; });
  return state.pending;
}

/** Call after a write that changes the overlay, so the next request sees it. */
export function overlayChanged() {
  state.checkedAt = 0;
}

async function refresh(): Promise<LeadIndex> {
  const sql = db();
  const [stamp] = await sql`SELECT
      (SELECT version FROM map_snapshots ORDER BY uploaded_at DESC, built_at DESC LIMIT 1) AS snapshot,
      (SELECT coalesce(max(id), 0)::text FROM manual_reviews) AS reviews,
      (SELECT coalesce(max(applied_at)::text, '') FROM manual_reviews) AS applied,
      (SELECT coalesce(max(updated_at)::text, '') FROM pipeline) AS pipeline_at,
      (SELECT count(*)::text FROM pipeline) AS pipeline_n`;
  if (!stamp.snapshot) throw new NoSnapshotError("no map snapshot online yet: run sync-online.mjs on the laptop");
  if (stamp.snapshot !== state.snapshotVersion || !state.index) {
    const [row] = await sql`SELECT version, built_at, payload FROM map_snapshots WHERE version = ${stamp.snapshot}`;
    state.index = new LeadIndex(JSON.parse(gunzipSync(row.payload).toString("utf8")));
    state.snapshotVersion = row.version;
    state.builtAt = new Date(row.built_at).toISOString();
    state.overlayKey = "";
  }
  const key = [stamp.reviews, stamp.applied, stamp.pipeline_at, stamp.pipeline_n].join("|");
  if (key !== state.overlayKey) {
    await applyOverlay(state.index, state.builtAt, key);
    state.overlayKey = key;
  }
  state.checkedAt = Date.now();
  return state.index;
}

async function applyOverlay(index: LeadIndex, builtAt: string, key: string) {
  const sql = db();
  // A decision is in the snapshot once the laptop applied it and then built a newer
  // snapshot; until then the overlay shows it. Refused decisions change nothing.
  const reviews = await sql`SELECT venue_id, candidate_domain, decision FROM manual_reviews
    WHERE apply_error IS NULL AND (applied_at IS NULL OR created_at > ${builtAt}) ORDER BY id`;
  const status = new Map<string, string>();
  for (const review of reviews) {
    const i = index.indexOf(review.venue_id);
    if (i < 0) continue;
    if (review.decision === "approve") {
      status.set(review.venue_id, "verified");
      continue;
    }
    // A rejection of another domain leaves a verified website verified.
    const current = status.get(review.venue_id) ?? (index.baseStatus[i] === 0 ? "verified" : "");
    const verifiedDomain = registrableDomain(index.columns.verified_url[i] || "");
    if (current === "verified" && verifiedDomain && verifiedDomain !== review.candidate_domain) continue;
    status.set(review.venue_id, "rejected");
  }
  const stage = new Map<string, string>();
  for (const row of await sql`SELECT venue_id, stage FROM pipeline`) stage.set(row.venue_id, row.stage);
  index.applyOverlay({ status, stage, key: status.size || stage.size ? key : "" });
}
