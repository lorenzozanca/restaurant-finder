#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { collectVenueIds, selectUnseenSample, unseenSelectionDocument } from "./lib/unseen-selector.mjs";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runUnseenSelection(args) {
  const dbPath = resolve(required(args.db, "db"));
  const inventoryPath = resolve(required(args.inventory, "inventory"));
  const outputPath = resolve(required(args.output, "output"));
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const exclusionPaths = await benchmarkJsonPaths(resolve(args.benchmarkDir || "benchmark"), outputPath);
  const excluded = new Set();
  const exclusionInputs = [];
  for (const path of exclusionPaths) {
    const bytes = await readFile(path);
    const before = excluded.size;
    collectVenueIds(JSON.parse(bytes), excluded);
    exclusionInputs.push({ path: relative(process.cwd(), path), sha256: digest(bytes),
      venue_ids_added: excluded.size - before });
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let candidates;
  try { candidates = loadCandidates(db); } finally { db.close(); }
  const selected = selectUnseenSample(candidates, inventory.inventory.by_municipality,
    { seed: args.seed, excludedVenueIds: excluded });
  const document = unseenSelectionDocument(selected, {
    seed: args.seed,
    source: {
      inventory_path: relative(process.cwd(), inventoryPath),
      inventory_fingerprint: inventory.manifest.inventory_fingerprint,
      store_path: relative(process.cwd(), dbPath),
      overture_release: inventory.manifest.overture.release,
      overture_sha256: inventory.manifest.overture.sha256,
      boundaries_sha256: inventory.manifest.boundaries.sha256,
      queue_precondition: "all candidates queued with attempt_count 0 at selection time",
    },
    exclusions: { venue_id_count: excluded.size, inputs: exclusionInputs },
  });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { output: outputPath, selected: selected.length, excluded: excluded.size,
    fingerprint: document.candidate_fingerprint_sha256, strata_summary: document.strata_summary };
}

function loadCandidates(db) {
  const byVenue = new Map();
  // Keep these as two sequential scans. source_records intentionally has no
  // venue_id index, so a three-way join can choose a prohibitively expensive
  // nested-loop plan on the national store.
  for (const row of db.prepare(`SELECT j.job_id, j.venue_id, v.display_name AS name, j.payload_json
    FROM enrichment_jobs j JOIN venues v USING (venue_id)
    WHERE j.status = 'queued' AND j.attempt_count = 0 ORDER BY j.venue_id`).iterate()) {
    const payload = JSON.parse(row.payload_json);
    byVenue.set(row.venue_id, {
      job_id: row.job_id, venue_id: row.venue_id, name: row.name,
      type: "unknown", address: null, latitude: null, longitude: null,
      known_website: payload.known_website || null,
      istat_municipality_code: payload.istat_municipality_code,
      source_record_id: null, source_record_count: 0,
    });
  }
  for (const row of db.prepare(`SELECT venue_id, source_record_id,
      json_extract(payload_json, '$.type') AS type,
      json_extract(payload_json, '$.address') AS address,
      json_extract(payload_json, '$.latitude') AS latitude,
      json_extract(payload_json, '$.longitude') AS longitude
    FROM source_records ORDER BY source_record_id`).iterate()) {
    const candidate = byVenue.get(row.venue_id);
    if (!candidate) continue;
    candidate.source_record_count++;
    if (candidate.source_record_id) continue;
    candidate.source_record_id = row.source_record_id;
    candidate.type = row.type || "unknown";
    candidate.address = row.address || null;
    candidate.latitude = row.latitude ?? null;
    candidate.longitude = row.longitude ?? null;
  }
  return [...byVenue.values()];
}

async function benchmarkJsonPaths(root, excludedOutput) {
  const paths = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.name.endsWith(".json") && child !== excludedOutput) paths.push(child);
    }
  }
  await visit(root);
  return paths.sort();
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function required(value, name) { if (!value) throw new TypeError(`--${name} is required`); return value; }
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--help" || item === "-h") { result.help = true; continue; }
    if (!item.startsWith("--")) continue;
    const [raw, inline] = item.slice(2).split("=", 2);
    result[raw.replace(/-([a-z])/g, (_match, char) => char.toUpperCase())] = inline ?? argv[++index];
  }
  return result;
}

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log("Usage: node select-unseen.mjs --db PATH --inventory PATH --output PATH [--benchmark-dir PATH] [--seed VALUE]");
  else {
    try { console.log(JSON.stringify(await runUnseenSelection(args), null, 2)); }
    catch (error) { console.error(`select-unseen: ${error.message}`); process.exitCode = 1; }
  }
}
