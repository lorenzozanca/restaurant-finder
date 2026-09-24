#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { collectVenueIds } from "./lib/unseen-selector.mjs";
import { normalizeCandidateUrl, validateWebFixtureDocument } from "./lib/web-stress-fixture.mjs";

// Seeded, region-stratified sample of venues that have a source (Overture) website
// candidate: the production population for the LLM reviewer pilot and holdout
// (PROCESS.md step 3). Every venue ID in prior benchmark artifacts, and in any extra
// exclusion directories, is excluded.

export function selectSourceSample(rows, options) {
  const count = options.count;
  const excluded = options.excludedVenueIds || new Set();
  const eligible = rows.filter((row) => !excluded.has(row.venue_id));
  const byRegion = Map.groupBy(eligible, (row) => row.region || "unknown");
  const random = seededRandom(options.seed);
  const regions = [...byRegion.keys()].sort();
  // Largest-remainder proportional allocation keeps the sample representative.
  const quotas = regions.map((region) => {
    const exact = count * byRegion.get(region).length / eligible.length;
    return { region, base: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let short = count - quotas.reduce((sum, quota) => sum + quota.base, 0);
  for (const quota of quotas.toSorted((left, right) => right.remainder - left.remainder
      || left.region.localeCompare(right.region))) {
    if (short-- <= 0) break;
    quota.base++;
  }
  return quotas.flatMap(({ region, base }) => {
    const pool = byRegion.get(region).toSorted((left, right) => left.venue_id.localeCompare(right.venue_id));
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    return pool.slice(0, base);
  }).toSorted((left, right) => left.venue_id.localeCompare(right.venue_id));
}

export function sourceFixtureDocument(selected, { partition, fingerprint, retrievedAt }) {
  return {
    schema_version: 1,
    fixture_set: `source-candidate-${partition}`,
    source: "source_candidate",
    brave_requests_made: 0,
    selection_fingerprint_sha256: fingerprint,
    bounded_result_limit: 1,
    entries: selected.map((row) => ({
      venue_id: row.venue_id, name: row.name, municipality: row.municipality, region: row.region,
      address: row.address || "", partition, query: "source_candidate", retrieved_at: retrievedAt,
      candidates: [{ title: row.name, url: row.url }], adjudication: null,
    })),
  };
}

function loadRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = new Map();
    for (const row of db.prepare(`SELECT v.venue_id, v.display_name, v.municipality,
        COALESCE(json_extract(s.payload_json, '$.region'), json_extract(s.payload_json, '$.region_code')) AS region,
        json_extract(s.payload_json, '$.address') AS address,
        json_extract(s.payload_json, '$.website') AS website
      FROM venues v JOIN source_records s ON s.venue_id = v.venue_id
      WHERE v.lifecycle_status = 'active' AND json_extract(s.payload_json, '$.website') LIKE 'http%'
      ORDER BY v.venue_id, s.source_record_id`).iterate()) {
      if (rows.has(row.venue_id)) continue;
      const url = normalizeCandidateUrl(row.website);
      if (!url) continue;
      rows.set(row.venue_id, { venue_id: row.venue_id, name: row.display_name,
        municipality: row.municipality, region: row.region || "", address: row.address || "", url });
    }
    return [...rows.values()];
  } finally { db.close(); }
}

function jsonFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? jsonFiles(path) : name.endsWith(".json") ? [path] : [];
  });
}

function seededRandom(seed) {
  let state = createHash("sha256").update(String(seed)).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const result = { excludeDirs: ["benchmark"] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--db") result.db = argv[++index];
    else if (flag === "--count") result.count = Number(argv[++index]);
    else if (flag === "--seed") result.seed = argv[++index];
    else if (flag === "--partition") result.partition = argv[++index];
    else if (flag === "--output-dir") result.outputDir = argv[++index];
    else if (flag === "--exclude-dir") result.excludeDirs.push(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  for (const key of ["db", "count", "seed", "partition", "outputDir"]) {
    if (!result[key]) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (!["development", "locked_holdout"].includes(result.partition)) throw new Error("invalid partition");
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  const excluded = new Set();
  const exclusionInputs = [];
  for (const path of args.excludeDirs.flatMap((dir) => jsonFiles(resolve(dir)))) {
    const bytes = readFileSync(path);
    const before = excluded.size;
    try { collectVenueIds(JSON.parse(bytes), excluded); } catch { continue; }
    exclusionInputs.push({ path: relative(process.cwd(), path),
      sha256: createHash("sha256").update(bytes).digest("hex"), venue_ids_added: excluded.size - before });
  }
  const rows = loadRows(resolve(args.db));
  const selected = selectSourceSample(rows, { count: args.count, seed: args.seed, excludedVenueIds: excluded });
  const fingerprint = createHash("sha256").update(JSON.stringify({ seed: args.seed, count: args.count,
    venues: selected.map((row) => [row.venue_id, row.url]) })).digest("hex");
  const document = sourceFixtureDocument(selected, { partition: args.partition, fingerprint,
    retrievedAt: new Date().toISOString() });
  validateWebFixtureDocument(document, { expectedEntries: args.count });
  mkdirSync(resolve(args.outputDir), { recursive: true });
  const prefix = args.partition === "development" ? "development" : "locked-holdout";
  const name = `${prefix}-001-${String(args.count).padStart(3, "0")}.json`;
  writeFileSync(join(resolve(args.outputDir), name), `${JSON.stringify(document, null, 2)}\n`);
  writeFileSync(join(resolve(args.outputDir), "selection-manifest.json"), `${JSON.stringify({
    selected_at: document.entries[0]?.retrieved_at, seed: args.seed, count: args.count,
    partition: args.partition, eligible_source_candidate_venues: rows.length,
    excluded_venue_ids: excluded.size, exclusion_inputs: exclusionInputs,
    selection_fingerprint_sha256: fingerprint,
    by_region: Object.fromEntries([...Map.groupBy(selected, (row) => row.region)].map(([k, v]) => [k, v.length])),
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: join(args.outputDir, name), selected: selected.length,
    eligible: rows.length, excluded: excluded.size, fingerprint }, null, 2)}\n`);
}
