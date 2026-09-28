import "server-only";
import { gunzipSync } from "node:zlib";
import { crmOverlay, crmStamp } from "@rf/crm-records.mjs";
import { LeadIndex } from "@rf/national-leads.mjs";
import { registrableDomain } from "@rf/publisher-ownership.mjs";
import { db } from "@/lib/db";

// The lead index the map and the tables answer from: the newest snapshot the laptop
// uploaded (sync-online.mjs), plus an overlay of what changed online since: manual
// decisions not yet in a snapshot, pipeline stages, and the CRM columns (next action,
// last touch, contacts). Held in memory per server instance and re-checked against
// the database at most every CHECK_MS.

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
  const [[stamp], crm] = await Promise.all([sql`SELECT
      (SELECT version FROM map_snapshots ORDER BY uploaded_at DESC, built_at DESC LIMIT 1) AS snapshot,
      (SELECT coalesce(max(id), 0)::text FROM manual_reviews) AS reviews,
      (SELECT coalesce(max(applied_at)::text, '') FROM manual_reviews) AS applied`, crmStamp(sql)]);
  if (!stamp.snapshot) throw new NoSnapshotError("no map snapshot online yet: run sync-online.mjs on the laptop");
  if (stamp.snapshot !== state.snapshotVersion || !state.index) {
    const started = performance.now();
    const [row] = await sql`SELECT version, built_at, payload FROM map_snapshots WHERE version = ${stamp.snapshot}`;
    const fetched = performance.now();
    state.index = new LeadIndex(JSON.parse(gunzipSync(row.payload).toString("utf8")));
    // Visible in the Vercel runtime logs: how long a cold start spends on the map.
    console.log(`lead index ${row.version}: fetch ${Math.round(fetched - started)} ms, `
      + `build ${Math.round(performance.now() - fetched)} ms`);
    state.snapshotVersion = row.version;
    state.builtAt = new Date(row.built_at).toISOString();
    state.overlayKey = "";
  }
  const key = [stamp.reviews, stamp.applied, crm].join("|");
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
  const [reviews, { stage, crm }] = await Promise.all([sql`SELECT venue_id, candidate_domain, decision
    FROM manual_reviews WHERE apply_error IS NULL AND (applied_at IS NULL OR created_at > ${builtAt}) ORDER BY id`,
  crmOverlay(sql)]);
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
  index.applyOverlay({ status, stage, crm, key: status.size || stage.size || crm.size ? key : "" });
}
