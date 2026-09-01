#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PILOT_MUNICIPALITIES, pilotDocument, selectPilot } from "./lib/pilot-selector.mjs";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runPilotSelection(args) {
  const dbPath = resolve(required(args.db, "db"));
  const inventoryPath = resolve(required(args.inventory, "inventory"));
  const outputPath = resolve(required(args.output, "output"));
  const inventoryDocument = JSON.parse(await readFile(inventoryPath, "utf8"));
  const database = new DatabaseSync(dbPath, { readOnly: true });
  let candidates;
  try { candidates = loadCandidates(database, PILOT_MUNICIPALITIES.map((item) => item.istat_code)); }
  finally { database.close(); }
  const selected = selectPilot(candidates, inventoryDocument.inventory.by_municipality);
  const document = pilotDocument(selected, {
    source: {
      inventory_path: args.inventory,
      inventory_fingerprint: inventoryDocument.manifest.inventory_fingerprint,
      store_path: args.db,
      overture_release: inventoryDocument.manifest.overture.release,
      overture_sha256: inventoryDocument.manifest.overture.sha256,
      boundaries_sha256: inventoryDocument.manifest.boundaries.sha256,
      queue_precondition: "selected jobs queued with attempt_count 0 at selection time",
    },
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { output: outputPath, candidates: selected.length, live_requests_made: 0,
    strata_summary: document.strata_summary };
}

function loadCandidates(database, municipalityCodes) {
  const placeholders = municipalityCodes.map(() => "?").join(", ");
  const queueRows = database.prepare(`
    SELECT j.job_id, j.venue_id, v.display_name AS name, j.payload_json
    FROM enrichment_jobs j JOIN venues v ON v.venue_id = j.venue_id
    WHERE j.status = 'queued' AND j.attempt_count = 0
      AND json_extract(j.payload_json, '$.istat_municipality_code') IN (${placeholders})
  `).all(...municipalityCodes);
  // Shortlist before touching source payloads. This keeps the read-only query
  // fast even for Roma and Milano, where the source_records table deliberately
  // has no venue_id index.
  const shortlist = [];
  for (const stratum of PILOT_MUNICIPALITIES) {
    for (const coverage of ["known", "missing"]) {
      const cell = queueRows.filter((row) => {
        const payload = JSON.parse(row.payload_json);
        return payload.istat_municipality_code === stratum.istat_code
          && (payload.known_website ? "known" : "missing") === coverage;
      }).sort((left, right) => hash(left.venue_id).localeCompare(hash(right.venue_id)));
      const selected = cell.slice(0, 16);
      if (coverage === "known" && stratum.force_known_name) {
        const forced = cell.filter((row) => row.name === stratum.force_known_name)
          .sort((left, right) => hash(left.venue_id).localeCompare(hash(right.venue_id)))[0];
        if (forced && !selected.some((row) => row.venue_id === forced.venue_id)) selected.push(forced);
      }
      shortlist.push(...selected);
    }
  }
  const uniqueShortlist = [...new Map(shortlist.map((row) => [row.venue_id, row])).values()];
  const sourcePlaceholders = uniqueShortlist.map(() => "?").join(", ");
  const sourceRows = database.prepare(`SELECT venue_id, source_record_id, payload_json
    FROM source_records WHERE venue_id IN (${sourcePlaceholders})
    ORDER BY venue_id, source_record_id`).all(...uniqueShortlist.map((row) => row.venue_id));
  const queueByVenue = new Map(uniqueShortlist.map((row) => [row.venue_id, row]));
  const rows = sourceRows.map((source) => ({ ...queueByVenue.get(source.venue_id),
    source_record_id: source.source_record_id, source_payload_json: source.payload_json }));
  const byVenue = new Map();
  for (const row of rows) {
    if (!byVenue.has(row.venue_id)) byVenue.set(row.venue_id, []);
    byVenue.get(row.venue_id).push(row);
  }
  return [...byVenue.values()].map((venueRows) => {
    const row = venueRows[0];
    const payload = JSON.parse(row.payload_json);
    const source = JSON.parse(row.source_payload_json);
    return {
      job_id: row.job_id,
      venue_id: row.venue_id,
      name: row.name,
      type: source.type || "unknown",
      address: source.address || null,
      latitude: source.latitude ?? null,
      longitude: source.longitude ?? null,
      known_website: payload.known_website || null,
      source_record_id: source.source_record_id,
      source_record_count: venueRows.length,
      istat_municipality_code: payload.istat_municipality_code,
    };
  });
}

function hash(value) { return createHash("sha256").update(`pilot-shortlist:${value}`).digest("hex"); }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--help" || item === "-h") { result.help = true; continue; }
    if (!item.startsWith("--")) continue;
    const [rawKey, inline] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[key] = inline ?? argv[++index];
  }
  return result;
}
function required(value, name) { if (!value) throw new TypeError(`--${name} is required`); return value; }
function usage() {
  return "Usage: node select-pilot.mjs --db PATH --inventory PATH --output PATH\n\n" +
    "Reads the national queue without mutation and writes a deterministic Session 10 selection with blank review labels.";
}

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log(usage());
  else {
    try { console.log(JSON.stringify(await runPilotSelection(args), null, 2)); }
    catch (error) { console.error(`select-pilot: ${error.message}`); process.exitCode = 1; }
  }
}
