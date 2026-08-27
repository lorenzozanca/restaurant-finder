#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importOverturePlaces } from "../sources/overture-places.mjs";
import { evaluateGapQueryReplay } from "../lib/gap-discovery.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function evaluateStructuredRecall(options = {}) {
  const truth = JSON.parse(await readFile(options.truthPath || resolve(ROOT, "v2/oderzo-truth.json"), "utf8"));
  const scan = JSON.parse(await readFile(options.osmScanPath || resolve(ROOT, "v2/scans/oderzo-2026-08-26.json"), "utf8"));
  const overture = await importOverturePlaces(
    options.overturePath || resolve(ROOT, "v2/overture-places-oderzo.geojson"), truth.location,
  );
  const gapReplay = JSON.parse(await readFile(options.gapReplayPath || resolve(ROOT, "v2/gap-query-replay.json"), "utf8"));
  const currentTruth = truth.venues.filter((item) => item.status === "current");
  const osm = scan.restaurants.filter((item) => (item.sources || [item.source]).includes("nominatim"));
  const osmReport = sourceCombination("osm", osm, currentTruth);
  const combinedReport = sourceCombination("osm+overture", [...osm, ...overture.items], currentTruth);
  const gap = evaluateGapQueryReplay(gapReplay.templates, gapReplay.already_found_truth_ids);
  return {
    mode: "offline-deterministic-adapter-replay",
    fixture_disclaimer: "The Overture-shaped fixture validates import and marginal-recall behavior; it is not a downloaded current Overture release snapshot.",
    location: truth.location,
    combinations: [osmReport, combinedReport],
    overture_import: overture.report,
    gap_discovery: gap,
    brave_places: { status: "not_run", reason: "supported API key/plan not configured; no live requests allowed in this phase run" },
  };
}

function sourceCombination(name, records, truth) {
  const matched = new Map();
  const unmatched = [];
  for (const record of records) {
    const truthItem = truth.find((item) => matchesTruth(record, item));
    if (!truthItem) unmatched.push(record.name);
    else matched.set(truthItem.id, [...(matched.get(truthItem.id) || []), record]);
  }
  const officialUrls = [...matched.entries()].flatMap(([truthId, candidates]) => {
    const item = truth.find((entry) => entry.id === truthId);
    return candidates.filter((candidate) => (item.official_websites || []).some((url) =>
      canonicalDomain(url) === canonicalDomain(candidate.website))).map((candidate) => candidate.website);
  });
  return {
    name,
    candidate_count: records.length,
    truth_venues_found: matched.size,
    truth_venue_total: truth.length,
    recall: rounded(matched.size / truth.length),
    truth_ids: [...matched.keys()].sort(),
    duplicate_truth_ids: [...matched].filter(([, values]) => values.length > 1).map(([id]) => id).sort(),
    wrong_category_or_unlabelled_candidates: [...new Set(unmatched)].sort(),
    official_url_count: new Set(officialUrls.map(canonicalDomain)).size,
  };
}

function matchesTruth(record, truth) {
  const names = [truth.name, ...(truth.aliases || [])].map(normalize);
  return names.includes(normalize(record.name))
    || (truth.osm_id && record.osm_id === truth.osm_id);
}
function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function canonicalDomain(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function rounded(value) { return Math.round(value * 10_000) / 10_000; }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  console.log(JSON.stringify(await evaluateStructuredRecall(), null, 2));
}
