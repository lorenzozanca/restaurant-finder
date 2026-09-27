import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readMapSnapshot, snapshotPathFor, storeStamp, writeMapSnapshot } from "./map-snapshot.mjs";
import { recordReviewDecision } from "./review-queue.mjs";
import { buildVenueDetails } from "./venue-details.mjs";

// One sync between the laptop and the online CRM database (PROCESS.md, "Online lead
// CRM"). Order matters: manual decisions made online are applied to the store first,
// so the snapshot pushed afterwards already contains them.

const SNAPSHOTS_KEPT = 2;
const BACKUPS_KEPT = 30;
const CHUNK = 2000;
export const CRM_TABLES = ["pipeline", "pipeline_events", "manual_reviews"];

export async function syncOnline({ sql, dbPath, reviewDbPath, backupDir, log = () => {}, details = true,
  now = () => new Date() }) {
  const startedAt = now();
  const summary = {};
  summary.reviews = await pullManualReviews(sql, dbPath, { now });
  log(`manual reviews: ${summary.reviews.applied} applied, ${summary.reviews.failed} failed`);
  const snapshot = currentSnapshot(dbPath, { log });
  summary.snapshot = await pushSnapshot(sql, snapshot);
  log(`snapshot ${snapshot.version} (${snapshot.count} venues): ${summary.snapshot.uploaded ? "uploaded" : "already online"}`);
  if (details) {
    summary.details = await pushVenueDetails(sql, buildVenueDetails(dbPath, snapshot, { reviewDbPath }));
    log(`venue details: ${summary.details.upserted} changed, ${summary.details.deleted} removed, ${summary.details.total} online`);
  }
  if (backupDir) {
    summary.backup = await backupCrm(sql, backupDir, { now });
    log(`CRM backup: ${summary.backup.path} (${Object.entries(summary.backup.rows).map(([t, n]) => `${t} ${n}`).join(", ")})`);
  }
  await sql`INSERT INTO sync_runs (started_at, summary) VALUES (${startedAt}, ${sql.json(summary)})`;
  return summary;
}

// Replays every pending online decision through recordReviewDecision, oldest first,
// with the online decision time. A decision the store refuses is marked with its
// error, so it is not retried forever and the venue card can show why.
export async function pullManualReviews(sql, dbPath, { apply = recordReviewDecision, now = () => new Date() } = {}) {
  const pending = await sql`SELECT id, body, created_at FROM manual_reviews WHERE applied_at IS NULL ORDER BY id`;
  let applied = 0, failed = 0;
  for (const row of pending) {
    const body = { ...row.body, reviewed_at: new Date(row.created_at).toISOString() };
    try {
      const attestation = apply(dbPath, body, { now: now() });
      await sql`UPDATE manual_reviews SET applied_at = now(), apply_error = NULL,
        attestation = ${sql.json(attestation)} WHERE id = ${row.id}`;
      applied++;
    } catch (error) {
      await sql`UPDATE manual_reviews SET applied_at = now(), apply_error = ${String(error.message || error)}
        WHERE id = ${row.id}`;
      failed++;
    }
  }
  return { pending: pending.length, applied, failed };
}

// The snapshot file next to the store, rebuilt when the store changed after it.
export function currentSnapshot(dbPath, { log = () => {} } = {}) {
  const path = snapshotPathFor(dbPath);
  if (existsSync(path)) {
    const snapshot = readMapSnapshot(path);
    if (snapshot.store_stamp >= storeStamp(dbPath)) return snapshot;
  }
  log("rebuilding the map snapshot…");
  writeMapSnapshot(dbPath, path);
  return readMapSnapshot(path);
}

export async function pushSnapshot(sql, snapshot) {
  const [existing] = await sql`SELECT version FROM map_snapshots WHERE version = ${snapshot.version}`;
  if (!existing) {
    const payload = gzipSync(Buffer.from(JSON.stringify(snapshot)));
    await sql`INSERT INTO map_snapshots (version, built_at, store_stamp, venue_count, stats, payload)
      VALUES (${snapshot.version}, ${snapshot.built_at}, ${snapshot.store_stamp}, ${snapshot.count},
        ${sql.json(snapshot.stats)}, ${payload})`;
  }
  await sql`DELETE FROM map_snapshots WHERE version NOT IN (
    SELECT version FROM map_snapshots ORDER BY uploaded_at DESC, built_at DESC LIMIT ${SNAPSHOTS_KEPT})`;
  return { version: snapshot.version, uploaded: !existing };
}

// details: Map venue_id -> { detail, hash } (lib/venue-details.mjs). Sends only rows
// whose hash changed, and removes venues that no longer have any detail.
export async function pushVenueDetails(sql, details) {
  const remote = new Map((await sql`SELECT venue_id, detail_hash FROM venue_details`)
    .map((row) => [row.venue_id, row.detail_hash]));
  const changed = [...details].filter(([venueId, { hash }]) => remote.get(venueId) !== hash);
  for (let k = 0; k < changed.length; k += CHUNK) {
    const chunk = changed.slice(k, k + CHUNK);
    await sql`INSERT INTO venue_details (venue_id, detail, detail_hash)
      SELECT * FROM unnest(${chunk.map(([venueId]) => venueId)}::text[],
        ${chunk.map(([, value]) => JSON.stringify(value.detail))}::text[]::jsonb[],
        ${chunk.map(([, value]) => value.hash)}::text[])
      ON CONFLICT (venue_id) DO UPDATE SET detail = excluded.detail, detail_hash = excluded.detail_hash,
        updated_at = now()`;
  }
  const gone = [...remote.keys()].filter((venueId) => !details.has(venueId));
  for (let k = 0; k < gone.length; k += CHUNK) {
    await sql`DELETE FROM venue_details WHERE venue_id = ANY(${gone.slice(k, k + CHUNK)}::text[])`;
  }
  return { upserted: changed.length, deleted: gone.length, total: details.size };
}

// Copies every CRM table to a dated JSON file on the laptop: Neon's free plan keeps
// only 6 hours of history, and these rows exist nowhere else.
export async function backupCrm(sql, directory, { now = () => new Date() } = {}) {
  mkdirSync(directory, { recursive: true });
  const tables = {};
  const rows = {};
  for (const table of CRM_TABLES) {
    tables[table] = await sql`SELECT * FROM ${sql(table)} ORDER BY 1`;
    rows[table] = tables[table].length;
  }
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `crm-${stamp}.json`);
  writeFileSync(`${path}.tmp`, JSON.stringify({ taken_at: now().toISOString(), tables }, null, 1));
  renameSync(`${path}.tmp`, path);
  const files = readdirSync(directory).filter((file) => /^crm-.*\.json$/.test(file)).sort();
  for (const file of files.slice(0, Math.max(0, files.length - BACKUPS_KEPT))) rmSync(join(directory, file));
  return { path, rows };
}
