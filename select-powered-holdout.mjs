#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { collectVenueIds } from "./lib/unseen-selector.mjs";

const SAMPLE_PER_REGION = 25;
const SEED = "italy-powered-holdout-2026-09-02-v1";
const SELECTION_ID = "session-12-national-powered-holdout-v1";
const LANGUAGE_VARIANT_REGIONS = new Set(["02", "04", "06"]);
const TOURISM_MUNICIPALITIES = new Set([
  "007022", "021061", "025016", "010044", "052028", "054050", "042048",
  "066093", "072003", "076024", "078041", "081008", "114035",
]);
const CHAIN_PATTERN = /\b(?:mcdonald'?s|burger king|kfc|subway|starbucks|old wild west|roadhouse|rossopomodoro|la piadineria|domino'?s|america graffiti|poke house|signorvino)\b/i;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runPoweredHoldoutSelection(args) {
  const dbPath = resolve(required(args.db, "db"));
  const inventoryPath = resolve(required(args.inventory, "inventory"));
  const outputPath = resolve(required(args.output, "output"));
  const benchmarkDirectory = resolve(args.benchmarkDir || "benchmark");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const inventoryByCode = new Map(inventory.inventory.by_municipality.map((row) =>
    [row.istat_code, row]));
  const exclusionPaths = await benchmarkJsonPaths(benchmarkDirectory, outputPath);
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
  const eligible = candidates.filter((row) => !excluded.has(row.venue_id)).map((row) => {
    const municipality = inventoryByCode.get(row.istat_municipality_code);
    if (!municipality) throw new Error(`missing municipality ${row.istat_municipality_code}`);
    return { ...row, region_code: municipality.region_code, region: municipality.region,
      municipality: municipality.municipality,
      municipality_inventory_venues: municipality.canonical_venues,
      municipality_size_stratum: sizeStratum(municipality.canonical_venues),
      tourism_stratum: TOURISM_MUNICIPALITIES.has(municipality.istat_code)
        ? "tourism_focus" : "general_market",
      website_coverage_stratum: row.known_website ? "known" : "missing",
      chain_stratum: CHAIN_PATTERN.test(row.name || "") ? "known_chain" : "independent_or_unknown",
      language_variant_stratum: LANGUAGE_VARIANT_REGIONS.has(municipality.region_code)
        || /[^\u0000-\u007f]/.test(String(row.name || "")) ? "included" : "standard" };
  });
  const regions = [...new Set(inventory.inventory.by_municipality.map((row) => row.region_code))].sort();
  if (regions.length !== 20) throw new Error(`expected 20 regions, found ${regions.length}`);
  const selected = [];
  for (const regionCode of regions) {
    const pool = eligible.filter((row) => row.region_code === regionCode);
    const chosen = [];
    for (let slot = 0; slot < SAMPLE_PER_REGION; slot++) {
      const website = slot % 2 === 0 ? "known" : "missing";
      const remaining = pool.filter((row) => row.website_coverage_stratum === website
        && !chosen.some((item) => item.venue_id === row.venue_id));
      if (!remaining.length) throw new Error(`region ${regionCode} lacks ${website} candidates`);
      const targetSize = ["small", "medium", "large"][slot % 3];
      const picked = [...remaining].sort((left, right) =>
        selectionScore(left, chosen, targetSize, slot) - selectionScore(right, chosen, targetSize, slot)
        || digest(`${SEED}:${regionCode}:${slot}:${left.venue_id}`)
          .localeCompare(digest(`${SEED}:${regionCode}:${slot}:${right.venue_id}`))
        || left.venue_id.localeCompare(right.venue_id))[0];
      chosen.push({ ...picked, sample_index: selected.length + chosen.length + 1,
        region_sample_index: slot + 1, partition: "locked_holdout" });
    }
    selected.push(...chosen);
  }
  validateSelection(selected, excluded);
  const candidateFingerprint = digest(JSON.stringify(selected));
  const document = { schema_version: 1, selection_id: SELECTION_ID,
    generated_at: "2026-09-02T20:00:00.000Z", status: "frozen_before_search_outcomes",
    live_requests_made: 0, brave_requests_made: 0,
    source: { inventory_path: relative(process.cwd(), inventoryPath),
      inventory_fingerprint: inventory.manifest.inventory_fingerprint,
      store_path: relative(process.cwd(), dbPath), overture_release: inventory.manifest.overture.release,
      overture_sha256: inventory.manifest.overture.sha256,
      boundaries_sha256: inventory.manifest.boundaries.sha256,
      queue_precondition: "all candidates queued with attempt_count 0 at selection time" },
    exclusions: { venue_id_count: excluded.size, inputs: exclusionInputs },
    selection_configuration: { seed: SEED,
      method: "25 untouched queued venues per region; all 500 locked; alternating known/missing source-website targets; deterministic municipality-size, tourism, chain, language, venue-type and municipality balancing",
      sample_size: selected.length, locked_holdout_size: selected.length,
      partition_rule: "all selected venues remain locked until capture and independent adjudication are complete" },
    power_preregistration: { basis: "planning only; fixed before any search on this selection",
      prior_holdout_publication_rate: 0.22, minimum_flawless_publications: 73,
      expected_publications_at_prior_rate: 110,
      probability_of_at_least_73_at_prior_rate: 0.9999886579287481,
      caveat: "The prior rate is a sizing assumption, not an acceptance criterion or guarantee." },
    evaluation_preregistration: {
      policy: "publish only a candidate domain with independently verified venue ownership",
      tuning_policy: "no policy or evaluator changes after this selection; evaluate exactly once after complete capture and adjudication",
      official_site_precision_target: 0.95,
      interval: "two-sided 95% Wilson score interval",
      non_vacuity: "a system that publishes nothing cannot pass",
      acceptance: "non-vacuity and official-site precision Wilson lower bound >= 0.95",
      resource_role_metrics: "not evaluated by minimal URL/title fixtures" },
    strata_summary: summarize(selected), candidate_fingerprint_sha256: candidateFingerprint,
    candidates: selected };
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { output: outputPath, selected: selected.length, excluded: excluded.size,
    fingerprint: candidateFingerprint, strata_summary: document.strata_summary };
}

function selectionScore(row, chosen, targetSize, slot) {
  return (row.municipality_size_stratum === targetSize ? 0 : 100)
    + (row.tourism_stratum === (slot % 5 === 0 ? "tourism_focus" : "general_market") ? 0 : 70)
    + (row.chain_stratum === (slot % 10 === 1 ? "known_chain" : "independent_or_unknown") ? 0 : 20)
    + (row.language_variant_stratum === (slot % 10 === 2 ? "included" : "standard") ? 0 : 10)
    + chosen.filter((item) => item.type === row.type).length * 8
    + chosen.filter((item) => item.istat_municipality_code === row.istat_municipality_code).length * 5;
}
function validateSelection(rows, excluded) {
  if (rows.length !== 500 || new Set(rows.map((row) => row.venue_id)).size !== 500) {
    throw new Error("powered holdout must contain 500 unique venues");
  }
  if (rows.some((row) => excluded.has(row.venue_id) || row.partition !== "locked_holdout")) {
    throw new Error("powered holdout contains an excluded or unlocked venue");
  }
  for (const region of new Set(rows.map((row) => row.region_code))) {
    const regional = rows.filter((row) => row.region_code === region);
    if (regional.length !== 25 || regional.filter((row) => row.website_coverage_stratum === "known").length !== 13) {
      throw new Error(`invalid allocation for region ${region}`);
    }
  }
}
function loadCandidates(db) {
  const byVenue = new Map();
  for (const row of db.prepare(`SELECT j.job_id, j.venue_id, v.display_name AS name, j.payload_json
    FROM enrichment_jobs j JOIN venues v USING (venue_id)
    WHERE j.status = 'queued' AND j.attempt_count = 0 ORDER BY j.venue_id`).iterate()) {
    const payload = JSON.parse(row.payload_json);
    byVenue.set(row.venue_id, { job_id: row.job_id, venue_id: row.venue_id, name: row.name,
      type: "unknown", address: null, latitude: null, longitude: null,
      known_website: payload.known_website || null,
      istat_municipality_code: payload.istat_municipality_code,
      source_record_id: null, source_record_count: 0 });
  }
  for (const row of db.prepare(`SELECT venue_id, source_record_id,
      json_extract(payload_json, '$.type') AS type, json_extract(payload_json, '$.address') AS address,
      json_extract(payload_json, '$.latitude') AS latitude, json_extract(payload_json, '$.longitude') AS longitude
    FROM source_records ORDER BY source_record_id`).iterate()) {
    const candidate = byVenue.get(row.venue_id);
    if (!candidate) continue;
    candidate.source_record_count++;
    if (candidate.source_record_id) continue;
    Object.assign(candidate, { source_record_id: row.source_record_id, type: row.type || "unknown",
      address: row.address || null, latitude: row.latitude ?? null, longitude: row.longitude ?? null });
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
function summarize(rows) {
  const result = {};
  for (const key of ["partition", "region_code", "municipality_size_stratum", "tourism_stratum",
    "website_coverage_stratum", "chain_stratum", "language_variant_stratum", "type"]) {
    const counts = {};
    for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
    result[key] = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  }
  return result;
}
function sizeStratum(count) { return count < 25 ? "small" : count < 150 ? "medium" : "large"; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function required(value, name) { if (!value) throw new TypeError(`--${name} is required`); return value; }
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const [raw, inline] = argv[index].slice(2).split("=", 2);
    result[raw.replace(/-([a-z])/g, (_match, char) => char.toUpperCase())] = inline ?? argv[++index];
  }
  return result;
}
if (isMain) {
  try { console.log(JSON.stringify(await runPoweredHoldoutSelection(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`select-powered-holdout: ${error.message}`); process.exitCode = 1; }
}
