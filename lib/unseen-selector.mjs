import { createHash } from "node:crypto";

export const UNSEEN_SELECTION_ID = "session-11-national-unseen-v1";
export const UNSEEN_SELECTION_SEED = "italy-unseen-2026-09-01-v1";
export const UNSEEN_SAMPLE_PER_REGION = 15;
export const UNSEEN_DEVELOPMENT_PER_REGION = 10;

// These labels are part of the frozen test design, not an official tourism
// classification. They deliberately reuse the broad geographic strata from
// Session 10 while selecting different venue IDs.
export const TOURISM_MUNICIPALITIES = new Set([
  "007022", "021061", "025016", "010044", "052028", "054050", "042048",
  "066093", "072003", "076024", "078041", "081008", "114035",
]);

const CHAIN_PATTERN = /\b(?:mcdonald'?s|burger king|kfc|subway|starbucks|old wild west|roadhouse|rossopomodoro|la piadineria|domino'?s|america graffiti|poke house|signorvino)\b/i;
const LANGUAGE_VARIANT_REGIONS = new Set(["02", "04", "06"]);

export function selectUnseenSample(candidates, municipalityInventory, options = {}) {
  const seed = String(options.seed || UNSEEN_SELECTION_SEED);
  const excluded = new Set(options.excludedVenueIds || []);
  const inventoryByCode = new Map(municipalityInventory.map((row) => [row.istat_code, row]));
  const eligible = candidates.filter((row) => !excluded.has(row.venue_id)).map((row) => {
    const municipality = inventoryByCode.get(row.istat_municipality_code);
    if (!municipality) throw new Error(`candidate ${row.venue_id} has no municipality inventory row`);
    return {
      ...row,
      region_code: municipality.region_code,
      region: municipality.region,
      municipality: municipality.municipality,
      municipality_inventory_venues: municipality.canonical_venues,
      municipality_size_stratum: sizeStratum(municipality.canonical_venues),
      tourism_stratum: TOURISM_MUNICIPALITIES.has(municipality.istat_code)
        ? "tourism_focus" : "general_market",
      website_coverage_stratum: row.known_website ? "known" : "missing",
      chain_stratum: CHAIN_PATTERN.test(row.name || "") ? "known_chain" : "independent_or_unknown",
      language_variant_stratum: LANGUAGE_VARIANT_REGIONS.has(municipality.region_code)
        || hasLanguageVariant(row.name) ? "included" : "standard",
    };
  });
  const regions = [...new Set(municipalityInventory.map((row) => row.region_code))].sort();
  if (regions.length !== 20) throw new Error(`expected 20 regions, found ${regions.length}`);
  const selected = [];
  for (const regionCode of regions) {
    const pool = eligible.filter((row) => row.region_code === regionCode);
    const chosen = [];
    for (let slot = 0; slot < UNSEEN_SAMPLE_PER_REGION; slot++) {
      const target = targetForSlot(slot);
      const remaining = pool.filter((row) => !chosen.some((item) => item.venue_id === row.venue_id));
      const coverage = remaining.filter((row) => row.website_coverage_stratum === target.website);
      if (!coverage.length) throw new Error(`region ${regionCode} lacks ${target.website} candidates`);
      const picked = [...coverage].sort((left, right) =>
        score(left, target, chosen) - score(right, target, chosen)
        || digest(`${seed}:${regionCode}:${slot}:${left.venue_id}`)
          .localeCompare(digest(`${seed}:${regionCode}:${slot}:${right.venue_id}`))
        || left.venue_id.localeCompare(right.venue_id))[0];
      chosen.push({ ...picked, sample_index: selected.length + chosen.length + 1,
        region_sample_index: slot + 1,
        partition: slot < UNSEEN_DEVELOPMENT_PER_REGION ? "development" : "locked_holdout" });
    }
    selected.push(...chosen);
  }
  validateSelection(selected, excluded);
  return selected;
}

export function unseenSelectionDocument(selected, input = {}) {
  const stableCandidates = selected.map((row) => ({ ...row }));
  const candidateFingerprint = digest(JSON.stringify(stableCandidates));
  return {
    schema_version: 1,
    selection_id: input.selectionId || UNSEEN_SELECTION_ID,
    generated_at: input.generatedAt || "2026-09-01T00:00:00.000Z",
    status: "frozen_before_search_outcomes",
    live_requests_made: 0,
    brave_requests_made: 0,
    source: input.source || {},
    exclusions: input.exclusions || {},
    selection_configuration: {
      seed: input.seed || UNSEEN_SELECTION_SEED,
      method: "15 untouched queued venues per region; fixed 10/5 development/locked-holdout split per region; exact alternating known/missing source-website targets; greedy municipality-size, tourism-focus, chain, language-variant, venue-type, and municipality balancing; seeded SHA-256 tie breaks",
      sample_size: stableCandidates.length,
      development_size: stableCandidates.filter((row) => row.partition === "development").length,
      locked_holdout_size: stableCandidates.filter((row) => row.partition === "locked_holdout").length,
      municipality_size_basis: "canonical venue count in the pinned national Overture inventory, not resident population",
      municipality_size_thresholds: { small: "1-24", medium: "25-149", large: "150+" },
      tourism_basis: "operator-designed stress-test focus; not an official tourism statistic",
      chain_basis: "bounded pre-registered name pattern; chain labels are sampling aids, not ownership evidence",
      partition_rule: "within each region, deterministic slots 1-10 are development and 11-15 are locked holdout",
    },
    evaluation_preregistration: {
      tuning_policy: "develop only against development; evaluate locked holdout exactly once after implementation freeze; any policy/code change caused by holdout results retires this holdout",
      review_unit: "one canonical venue; publisher ownership is separately adjudicated per registrable domain",
      publisher_classes: ["official", "directory", "menu_mirror", "booking_or_order_platform", "editorial_or_review", "social", "unrelated", "uncertain"],
      metrics: ["official_site_precision", "official_site_recall", "search_discovery_recall", "resource_role_precision", "resource_role_recall", "abstention", "coverage", "false_publication_by_publisher_class"],
      denominators: {
        official_site_precision: "published official-site predictions with a conclusive official/non-official adjudication",
        official_site_recall: "reviewed venues with a conclusively identified official site",
        search_discovery_recall: "reviewed venues with a conclusively identified official site that appears in the bounded search fixture",
        resource_role_precision: "published resource links with a conclusive role adjudication",
        resource_role_recall: "conclusively adjudicated venue resources present in the bounded fixture",
        abstention: "reviewed venues for which the system publishes no official site",
        coverage: "reviewed venues for which the system publishes an official site",
      },
      acceptance: {
        official_site_precision_target: 0.95,
        interval: "two-sided 95% Wilson score interval",
        non_vacuity: "a system that publishes nothing cannot pass",
        insufficient_power: "expand the offline unseen sample; do not use Brave",
      },
    },
    strata_summary: summarize(stableCandidates),
    candidate_fingerprint_sha256: candidateFingerprint,
    candidates: stableCandidates,
  };
}

export function collectVenueIds(value, output = new Set()) {
  if (Array.isArray(value)) for (const item of value) collectVenueIds(item, output);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["venue_id", "canonical_venue_id", "duplicate_of_venue_id"].includes(key)
          && typeof item === "string" && item.startsWith("venue:")) output.add(item);
      collectVenueIds(item, output);
    }
  }
  return output;
}

function targetForSlot(slot) {
  return {
    website: slot % 2 === 0 ? "known" : "missing",
    size: ["small", "medium", "large"][slot % 3],
    tourism: slot % 5 === 0 ? "tourism_focus" : "general_market",
    chain: slot === 1 || slot === 11 ? "known_chain" : "independent_or_unknown",
    language: slot === 2 || slot === 12 ? "included" : "standard",
  };
}

function score(row, target, chosen) {
  const typeCount = chosen.filter((item) => item.type === row.type).length;
  const municipalityCount = chosen.filter((item) => item.istat_municipality_code === row.istat_municipality_code).length;
  return (row.municipality_size_stratum === target.size ? 0 : 100)
    + (row.tourism_stratum === target.tourism ? 0 : 70)
    + (row.chain_stratum === target.chain ? 0 : 20)
    + (row.language_variant_stratum === target.language ? 0 : 10)
    + typeCount * 8 + municipalityCount * 5;
}

function validateSelection(selected, excluded) {
  if (selected.length !== 300) throw new Error(`expected 300 selected venues, found ${selected.length}`);
  if (new Set(selected.map((row) => row.venue_id)).size !== selected.length) throw new Error("duplicate venue IDs");
  if (selected.some((row) => excluded.has(row.venue_id))) throw new Error("excluded venue selected");
  for (const region of new Set(selected.map((row) => row.region_code))) {
    const rows = selected.filter((row) => row.region_code === region);
    if (rows.length !== 15) throw new Error(`region ${region} does not contain 15 venues`);
    if (rows.filter((row) => row.partition === "development").length !== 10
        || rows.filter((row) => row.partition === "locked_holdout").length !== 5) {
      throw new Error(`region ${region} has an invalid partition split`);
    }
    if (rows.filter((row) => row.website_coverage_stratum === "known").length !== 8) {
      throw new Error(`region ${region} has an invalid website-coverage split`);
    }
  }
}

function summarize(rows) {
  const keys = ["partition", "region_code", "municipality_size_stratum", "tourism_stratum",
    "website_coverage_stratum", "chain_stratum", "language_variant_stratum", "type"];
  return Object.fromEntries(keys.map((key) => [key, countBy(rows, key)]));
}
function countBy(rows, key) {
  const result = {};
  for (const row of rows) result[row[key]] = (result[row[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function sizeStratum(count) { return count < 25 ? "small" : count < 150 ? "medium" : "large"; }
function hasLanguageVariant(value) { return /[^\u0000-\u007f]/.test(String(value || "")); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
