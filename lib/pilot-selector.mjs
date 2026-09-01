import { createHash } from "node:crypto";

export const PILOT_SELECTION_ID = "session-10-national-calibration-v1";
export const PILOT_SEED = "italy-session-10-2026-08-28-v1";

// These are sampling strata, not demographic or tourism statistics. Inventory
// size is derived from the pinned Overture import; tourism focus is an explicit
// test-design label that must be checked during manual review.
export const PILOT_MUNICIPALITIES = Object.freeze([
  row("001272", "01", "general_market", { forceKnownName: "McDonald's" }),
  row("007022", "02", "tourism_focus", { languageVariant: true }),
  row("015146", "03", "general_market"),
  row("021061", "04", "tourism_focus", { languageVariant: true }),
  row("025016", "05", "tourism_focus"),
  row("032006", "06", "general_market", { languageVariant: true }),
  row("010044", "07", "tourism_focus"),
  row("037006", "08", "general_market"),
  row("052028", "09", "tourism_focus"),
  row("054050", "10", "tourism_focus"),
  row("042048", "11", "tourism_focus"),
  row("058091", "12", "general_market"),
  row("066093", "13", "tourism_focus"),
  row("094003", "14", "general_market"),
  row("063049", "15", "general_market"),
  row("072003", "16", "tourism_focus"),
  row("076024", "17", "tourism_focus"),
  row("078041", "18", "tourism_focus", { languageVariant: true }),
  row("081008", "19", "tourism_focus"),
  row("114035", "20", "tourism_focus"),
]);

export function selectPilot(candidates, municipalityInventory, options = {}) {
  const seed = String(options.seed || PILOT_SEED);
  const catalog = options.municipalities || PILOT_MUNICIPALITIES;
  const inventoryByCode = new Map(municipalityInventory.map((item) => [item.istat_code, item]));
  const candidatesByCode = groupBy(candidates, (item) => item.istat_municipality_code);
  const typeCounts = new Map();
  const selected = [];

  for (const stratum of catalog) {
    const inventory = inventoryByCode.get(stratum.istat_code);
    if (!inventory) throw new Error(`pilot municipality ${stratum.istat_code} is absent from inventory`);
    if (inventory.region_code !== stratum.region_code) {
      throw new Error(`pilot municipality ${stratum.istat_code} has unexpected region ${inventory.region_code}`);
    }
    const pool = candidatesByCode.get(stratum.istat_code) || [];
    for (const websiteCoverage of ["known", "missing"]) {
      let eligible = pool.filter((item) => (item.known_website ? "known" : "missing") === websiteCoverage);
      if (websiteCoverage === "known" && stratum.force_known_name) {
        const forced = eligible.filter((item) => item.name === stratum.force_known_name);
        if (forced.length) eligible = forced;
      }
      const chosen = choose(eligible, typeCounts, seed);
      if (!chosen) {
        throw new Error(`${stratum.istat_code} has no untouched queued candidate with ${websiteCoverage} website`);
      }
      typeCounts.set(chosen.type, (typeCounts.get(chosen.type) || 0) + 1);
      selected.push({
        selection_index: selected.length + 1,
        region_code: inventory.region_code,
        region: inventory.region,
        municipality: inventory.municipality,
        istat_municipality_code: inventory.istat_code,
        municipality_inventory_venues: inventory.canonical_venues,
        municipality_size_stratum: sizeStratum(inventory.canonical_venues),
        tourism_stratum: stratum.tourism_stratum,
        language_variant_stratum: stratum.language_variant ? "included" : "standard",
        website_coverage_stratum: websiteCoverage,
        chain_stratum: chosen.name === stratum.force_known_name ? "known_chain" : "unconstrained",
        ...chosen,
        review: blankReview(),
      });
    }
  }
  validate(selected, catalog);
  return selected;
}

export function pilotDocument(selected, input = {}) {
  const by = (key) => countBy(selected, (item) => item[key]);
  return {
    schema_version: 1,
    selection_id: PILOT_SELECTION_ID,
    generated_at: input.generatedAt || "2026-08-28T00:00:00.000Z",
    status: "selected_unreviewed_live_run_not_started",
    live_requests_made: 0,
    source: input.source || {},
    selection_configuration: {
      seed: input.seed || PILOT_SEED,
      method: "two untouched queued venues per region; one known source website and one missing; greedy venue-type balancing with seeded SHA-256 tie breaks",
      municipality_size_basis: "canonical venue count in the pinned national Overture inventory, not resident population",
      municipality_size_thresholds: { small: "2-24", medium: "25-149", large: "150+" },
      tourism_basis: "operator-designed sampling focus; verify during manual review; not an official tourism statistic",
      sample_size: selected.length,
    },
    run_limits: {
      reported_brave_allowance: 97,
      brave_request_ceiling_across_cold_and_warm: 72,
      retained_operational_reserve: 25,
      resolver_searches_per_venue: 3,
      resolver_crawls_per_venue: 3,
      worker_concurrency: 2,
      brave_provider_concurrency: 1,
      per_domain_concurrency: 1,
      provider_pacing_requests_per_second: 1,
      retries_per_job: 2,
      quota_behavior: "durable pause; never convert quota exhaustion to a result or review label",
    },
    scenarios: {
      cold: "isolated pilot database and empty HTTP/search caches",
      warm_incremental: "reuse the cold pilot database and caches; share the same 72-request ceiling",
    },
    authorization: {
      live_pilot: false,
      national_queue: false,
      publication: false,
      next_gate: "complete manual baseline labels and operator approval before any live request",
    },
    strata_summary: {
      regions: by("region_code"),
      municipality_size: by("municipality_size_stratum"),
      tourism: by("tourism_stratum"),
      language_variant: by("language_variant_stratum"),
      website_coverage: by("website_coverage_stratum"),
      venue_type: by("type"),
      chain: by("chain_stratum"),
    },
    review_label_schema: {
      venue_status: ["valid", "not_a_venue", "closed", "uncertain"],
      municipality_assignment: ["correct", "incorrect", "uncertain"],
      official_website_status: ["accepted", "rejected", "no_official_site", "uncertain"],
      resource_status: ["accepted", "rejected", "uncertain"],
      resource_roles: ["menu", "order", "booking"],
      null_policy: "null means not yet manually reviewed; it is never a negative label",
    },
    candidates: selected,
  };
}

function choose(candidates, typeCounts, seed) {
  return [...candidates].sort((left, right) =>
    ((typeCounts.get(left.type) || 0) - (typeCounts.get(right.type) || 0))
    || digest(`${seed}:${left.venue_id}`).localeCompare(digest(`${seed}:${right.venue_id}`))
    || left.venue_id.localeCompare(right.venue_id))[0];
}

function validate(selected, catalog) {
  if (selected.length !== catalog.length * 2) throw new Error("pilot selection has unexpected size");
  if (new Set(selected.map((item) => item.venue_id)).size !== selected.length) {
    throw new Error("pilot selection contains duplicate venue IDs");
  }
  for (const stratum of catalog) {
    const rows = selected.filter((item) => item.istat_municipality_code === stratum.istat_code);
    if (rows.length !== 2 || new Set(rows.map((item) => item.website_coverage_stratum)).size !== 2) {
      throw new Error(`${stratum.istat_code} does not have a known/missing website pair`);
    }
  }
}

function blankReview() {
  return {
    reviewer: null,
    reviewed_at: null,
    venue_status: null,
    municipality_assignment: null,
    duplicate_of_venue_id: null,
    official_website_status: null,
    official_website_url: null,
    resources: [],
    evidence_urls: [],
    notes: null,
  };
}

function row(istatCode, regionCode, tourismStratum, options = {}) {
  return Object.freeze({ istat_code: istatCode, region_code: regionCode,
    tourism_stratum: tourismStratum, language_variant: options.languageVariant === true,
    force_known_name: options.forceKnownName || null });
}
function sizeStratum(count) { return count < 25 ? "small" : count < 150 ? "medium" : "large"; }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function groupBy(values, keyFor) {
  const result = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(value);
  }
  return result;
}
function countBy(values, keyFor) {
  const result = {};
  for (const value of values) {
    const key = keyFor(value);
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}
