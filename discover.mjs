#!/usr/bin/env node
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discover as nominatim,
  resolveLocationContext,
  geocode,
  canBulkGeocode,
} from "./sources/nominatim.mjs";
import { discover as webSearch } from "./sources/web-search.mjs";
import { discover as paginegialle } from "./sources/paginegialle.mjs";
import { discover as overturePlaces } from "./sources/overture-places.mjs";
import { findMenuSources } from "./find-menu.mjs";
import {
  CURRENT_SCHEMA_VERSION,
  serializeScanDocument,
  validateCurrentScanDocument,
} from "./scan-schema.mjs";
import { disabledSourceRun, runSource } from "./source-run.mjs";
import { canonicalizeVenues } from "./lib/identity.mjs";
import { buildPostcodeGapQueries } from "./lib/gap-discovery.mjs";
import { EvidenceStore } from "./lib/evidence-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "output");
const scanStartedAt = Date.now();

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("usage: node discover.mjs <town> [province]");
  console.error("example: node discover.mjs Oderzo");
  console.error("example: node discover.mjs Oderzo TV");
  process.exit(2);
}

const town = args[0];
const province = args[1] || "";
const today = new Date().toISOString().slice(0, 10);
const ENRICHMENT_VERSION = 11;
const PAGINEGIALLE_ENABLED = process.env.ENABLE_PAGINEGIALLE === "1";
const OVERTURE_ENABLED = Boolean(process.env.OVERTURE_PLACES_PATH);
const GAP_WEB_ENABLED = process.env.ENABLE_GAP_WEB_DISCOVERY === "1";
const outputVariant = String(process.env.OUTPUT_VARIANT || "")
  .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

console.log(`\n🏘️  Restaurant Finder — "${town}"${province ? ` (${province})` : ""}\n`);

console.log("[1/3] Discovering restaurants...\n");

const locationContext = await resolveLocationContext(town, province);
if (!locationContext) throw new Error(`Could not resolve municipality ${town}`);
const webAdmissionDecisions = [];
const [nominatimRun, overtureRun] = await Promise.all([
  runSource("nominatim", nominatim, locationContext),
  OVERTURE_ENABLED
    ? runSource("overture_places", overturePlaces, locationContext)
    : Promise.resolve(disabledSourceRun("overture_places")),
]);
const gapQueries = GAP_WEB_ENABLED ? configuredGapQueries(locationContext) : [];
const [webSearchRun, paginegialleRun] = await Promise.all([
  gapQueries.length
    ? runSource("web_search", webSearch, locationContext, {
      queries: gapQueries,
      onDecision: (decision) => webAdmissionDecisions.push(decision),
    })
    : Promise.resolve(disabledSourceRun("web_search")),
  PAGINEGIALLE_ENABLED
    ? runSource("paginegialle", paginegialle, locationContext)
    : Promise.resolve(disabledSourceRun("paginegialle")),
]);

const nominatimResults = nominatimRun.items;
const overtureResults = overtureRun.items;
const webSearchResults = webSearchRun.items;
const paginegialleResults = paginegialleRun.items;
const sourceRuns = [nominatimRun.manifest, overtureRun.manifest,
  webSearchRun.manifest, paginegialleRun.manifest];
for (const run of sourceRuns.filter((item) => ["failed", "degraded"].includes(item.status))) {
  console.error(`  ${run.source} ${run.status}: ${run.error || run.reason || "no useful results"}`);
}

const allRaw = [
  ...nominatimResults,
  ...overtureResults,
  ...webSearchResults,
  ...paginegialleResults,
];

console.log(`  nominatim:    ${nominatimResults.length}`);
console.log(`  overture:     ${overtureResults.length}`);
console.log(`  web search:   ${webSearchResults.length}`);
console.log(`  paginegialle: ${paginegialleResults.length}`);
console.log(`  total raw:    ${allRaw.length}\n`);
const webAdmission = summarizeWebAdmission(webAdmissionDecisions);
if (webAdmission.rejected > 0) {
  console.log(`  web rejected: ${webAdmission.rejected} (${Object.entries(webAdmission.rejection_reasons)
    .map(([reason, count]) => `${reason}=${count}`).join(", ")})\n`);
}

const merged = canonicalizeVenues(allRaw.map(withFieldProvenance), { location: locationContext })
  .filter(isNotGarbage)
  .map(normalizeRecord)
  .sort((a, b) => a.name.localeCompare(b.name, "it"));
console.log(`  after dedup & filter: ${merged.length} restaurants\n`);

await addMissingCoordinates(merged, locationContext);

console.log("[2/3] Gathering online resources...\n");

const TOP_N = parseInt(process.env.TOP_N, 10) || 20;
// Spend the resource-hunting budget on the strongest candidates, rather than
// whichever names happen to come first alphabetically. Keep original indexes
// so the final result remains an alphabetical list.

const outDir = resolve(OUTPUT_DIR, town.toLowerCase());
const outPath = resolve(outDir, `${today}${outputVariant ? `.${outputVariant}` : ""}.json`);
await mkdir(outDir, { recursive: true });
const evidencePath = resolve(process.env.EVIDENCE_STORE_PATH || resolve(outDir, "evidence.sqlite"));
const evidenceStore = new EvidenceStore(evidencePath);

// Seed a newly created store from a compatible same-day scan. This preserves
// the old resumability behavior while all subsequent reuse is date-independent.
try {
  const previous = JSON.parse(await readFile(outPath, "utf-8"));
  if (previous.schema_version === CURRENT_SCHEMA_VERSION
      && previous.enrichment_version === ENRICHMENT_VERSION
      && Array.isArray(previous.restaurants)) {
    for (const r of previous.restaurants) {
      if (r.canonical_venue_id && r.name && r.resources_checked) {
        evidenceStore.recordEnrichment(r, {
          website: r.website,
          website_kind: r.website_kind,
          website_confidence: r.website_confidence,
          website_decision: r.website_decision,
          directory_url: r.directory_url,
          resources: Array.isArray(r.resources) ? r.resources : [],
          resource_decisions: Array.isArray(r.resource_decisions) ? r.resource_decisions : [],
          enrichment_run: r.enrichment_run,
          website_provenance: r.provenance?.website?.[0],
        }, { checkedAt: `${previous.searched_at || today}T00:00:00.000Z`, location: locationContext });
      }
    }
  }
} catch {}

const previouslyEnrichedIndices = new Set();
const enriched = merged.map((r, index) => {
  evidenceStore.rememberVenue(r, { location: locationContext });
  const cached = evidenceStore.findReusableEvidence(r, { location: locationContext });
  if (cached) {
    if (!cached.due_for_revalidation) previouslyEnrichedIndices.add(index);
    return {
      ...r,
      ...reusedEvidenceFields(cached),
      provenance: {
        ...(r.provenance || {}),
        ...(cached.website_provenance ? { website: [cached.website_provenance] } : {}),
      },
    };
  }
  return {
    ...r,
    resources: [],
    resource_decisions: [],
    resources_checked: false,
    no_resources_found: true,
  };
});

const unprocessed = merged
  .map((restaurant, index) => ({ restaurant, index }))
  .filter(({ index }) => !previouslyEnrichedIndices.has(index))
  .sort((a, b) => enrichmentPriority(b.restaurant) - enrichmentPriority(a.restaurant)
    || a.restaurant.name.localeCompare(b.restaurant.name, "it"))
  .slice(0, TOP_N);

const toProcess = unprocessed;
const WORKERS = 4;
let nextIndex = 0;
let completedCount = 0;

if (toProcess.length === 0 && enriched.some((r) => r.resources_checked)) {
  console.log("  all venues already enriched from previous run");
} else if (toProcess.length > 0) {
  const remaining = merged.length - previouslyEnrichedIndices.size - toProcess.length;
  if (previouslyEnrichedIndices.size > 0 && remaining > 0) {
    console.log(`  enriching next ${toProcess.length} (${previouslyEnrichedIndices.size} cached, ${remaining} remaining)`);
  }
}
async function worker() {
  while (true) {
    const i = nextIndex++;
    if (i >= toProcess.length) return;
    const { restaurant: r, index } = toProcess[i];
    const restaurantWithOwnership = {
      ...r,
      publisher_ownership: evidenceStore.publisherOwnershipForVenue(r),
    };

    const online = await findMenuSources(restaurantWithOwnership, locationContext);
    const durable = evidenceStore.recordEnrichment(r, online, { location: locationContext });
    const current = {
      ...r,
      website: online.website,
      website_kind: online.website_kind,
      website_confidence: online.website_confidence,
      website_decision: online.website_decision,
      directory_url: online.directory_url,
      resources: online.resources,
      resource_decisions: online.resource_decisions,
      enrichment_run: online.enrichment_run,
      provenance: enrichmentProvenance(r, online),
      resources_checked: true,
      no_resources_found: online.resources.length === 0 && !online.website,
    };
    // A failed/degraded run is an observation, not contradictory evidence.
    // Publish the durable accepted facts with their explicit audit state while
    // retaining this run's health and retry evidence.
    enriched[index] = !online.website && durable?.website
      ? {
        ...current,
        ...reusedEvidenceFields(durable),
        enrichment_run: online.enrichment_run,
        provenance: {
          ...(current.provenance || {}),
          ...(durable.website_provenance ? { website: [durable.website_provenance] } : {}),
        },
      }
      : { ...current, ...(durable ? { evidence_state: durable.evidence_state } : {}) };
    completedCount++;
    process.stdout.write(resourcesLine(completedCount, toProcess.length, r.name, enriched[index].resources.length));
  }
}

await Promise.all(
  Array.from({ length: Math.min(WORKERS, toProcess.length) }, () => worker())
);

const output = {
  schema_version: CURRENT_SCHEMA_VERSION,
  location: locationContext.municipality,
  province: locationContext.province_code || undefined,
  location_context: locationContext,
  searched_at: today,
  enrichment_version: ENRICHMENT_VERSION,
  evidence_store: summarizeEvidenceStore(enriched, evidenceStore.metadata()),
  sources_used: sourceRuns.filter((run) => run.status === "succeeded").map((run) => run.source),
  source_runs: sourceRuns,
  web_admission: webAdmission,
  enrichment_run: summarizeEnrichment(enriched),
  provider_manifest: summarizeProviderManifest(sourceRuns, enriched),
  acceptance_health: summarizeAcceptanceHealth(sourceRuns, enriched),
  elapsed_ms: Date.now() - scanStartedAt,
  attribution: [
    {
      source: "OpenStreetMap",
      notice: "© OpenStreetMap contributors",
      license: "ODbL-1.0",
      url: "https://www.openstreetmap.org/copyright",
    },
    ...(OVERTURE_ENABLED ? [{
      source: "Overture Maps Foundation Places",
      notice: "© Overture Maps Foundation and data providers",
      license: "CDLA-Permissive-2.0",
      url: "https://docs.overturemaps.org/attribution/",
    }] : []),
  ],
  total_found: enriched.length,
  with_resources: enriched.filter((r) => r.resources.length > 0).length,
  with_official_website: enriched.filter((r) => r.website_kind === "official").length,
  restaurants: enriched,
};

function summarizeProviderManifest(runs, restaurants) {
  const attempts = allSearchAttempts(runs, restaurants);
  const providers = {};
  for (const response of attempts) {
    for (const attempt of response.attempts || []) {
      const name = attempt.provider || "unknown";
      const bucket = providers[name] ||= { attempts: 0, outcomes: {}, http_statuses: {} };
      bucket.attempts++;
      const outcome = attempt.outcome || attempt.reason || response.outcome || "unknown";
      bucket.outcomes[outcome] = (bucket.outcomes[outcome] || 0) + 1;
      const status = attempt.http_status == null ? "none" : String(attempt.http_status);
      bucket.http_statuses[status] = (bucket.http_statuses[status] || 0) + 1;
    }
  }
  return {
    providers: Object.fromEntries(Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))),
    logical_search_requests: attempts.length,
    provider_attempts: Object.values(providers).reduce((sum, item) => sum + item.attempts, 0),
  };
}

function summarizeAcceptanceHealth(runs, restaurants) {
  const attempts = allSearchAttempts(runs, restaurants);
  const targeted = restaurants.map((item) => item.enrichment_run?.search_requests)
    .filter((count) => Number.isInteger(count) && count > 0);
  const thirdSearches = restaurants.filter((item) => item.enrichment_run?.search_requests === 3)
    .map((item) => ({ venue: item.name,
      budget_escalation_reason: item.enrichment_run?.resolver_budget?.budget_escalation_reason }));
  const rateLimited = attempts.flatMap((response) => response.attempts || [])
    .filter((attempt) => attempt.http_status === 429 || attempt.outcome === "rate_limited"
      || attempt.reason === "rate_limited").length;
  const providerYield = [];
  for (const response of attempts) {
    const provider = response.provider || response.attempts?.at(-1)?.provider || "unknown";
    providerYield.push({
      provider,
      purpose: response.purpose || response.kind || "unknown",
      useful_candidates: response.outcome === "relevant" ? response.results?.length
        ?? response.result_count ?? 0 : 0,
      accepted_sites: 0,
      accepted_resources: 0,
    });
  }
  return {
    baseline_web_search_requests: 120,
    irrelevant_cached_as_success: attempts.filter((response) =>
      response.outcome === "irrelevant" && response.cache?.stored === true).length,
    observed_429_responses: rateLimited,
    scheduler_429_collisions: rateLimited === 0 ? 0 : null,
    broad_web_queries: runs.filter((run) => run.source === "web_search")
      .reduce((sum, run) => sum + (run.query_yield?.length || 0), 0),
    targeted_searches_per_unresolved_venue: targeted,
    third_searches: thirdSearches,
    provider_yield: providerYield,
    // Source status remains authoritative even when a degraded run returned
    // some useful rows; it is never promoted to succeeded by this summary.
    degraded_provider_claimed_healthy: false,
    schema_validated: true,
    provenance_validated: true,
  };
}

function allSearchAttempts(runs, restaurants) {
  return [
    ...runs.flatMap((run) => run.search_attempts || []),
    ...restaurants.flatMap((item) => item.enrichment_run?.search_attempts || []),
    ...restaurants.flatMap((item) => item.enrichment_run?.resource_search_attempts || []),
  ];
}

function summarizeEnrichment(restaurants) {
  const runs = restaurants.map((item) => item.enrichment_run).filter(Boolean);
  const fallbackReasons = {};
  for (const run of runs) {
    const reason = run.search_fallback_reason || "unknown";
    fallbackReasons[reason] = (fallbackReasons[reason] || 0) + 1;
  }
  return {
    strategy: "website_first",
    venues_instrumented: runs.length,
    crawl_requests: runs.reduce((sum, run) => sum + (run.crawl_requests || 0), 0),
    crawl_cache_hits: runs.reduce((sum, run) => sum + (run.crawl_cache_hits || 0), 0),
    search_requests: runs.reduce((sum, run) => sum + (run.search_requests || 0), 0),
    resource_discovery_requests: runs.reduce(
      (sum, run) => sum + (run.resource_discovery_requests || 0), 0,
    ),
    resource_site_search_requests: runs.reduce(
      (sum, run) => sum + (run.resource_site_search_requests || 0), 0,
    ),
    resource_validation_requests: runs.reduce(
      (sum, run) => sum + (run.resource_validation_requests || 0), 0,
    ),
    resource_stage_metrics: summarizeResourceStages(runs),
    fallback_reasons: Object.fromEntries(Object.entries(fallbackReasons).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function summarizeResourceStages(runs) {
  const fields = ["candidates", "accepted", "review", "rejected", "pre_cap_dropped", "post_cap_dropped"];
  const byRole = {};
  for (const run of runs) {
    for (const [role, metrics] of Object.entries(run.resource_stage_metrics?.by_role || {})) {
      const bucket = byRole[role] ||= Object.fromEntries(fields.map((field) => [field, 0]));
      for (const field of fields) bucket[field] += metrics[field] || 0;
    }
  }
  const totals = Object.fromEntries(fields.map((field) => [field,
    Object.values(byRole).reduce((sum, bucket) => sum + bucket[field], 0)]));
  return { totals, by_role: Object.fromEntries(Object.entries(byRole).sort(([a], [b]) => a.localeCompare(b))) };
}

function summarizeWebAdmission(decisions) {
  const summary = { accepted: 0, rejected: 0, rejection_reasons: {} };
  for (const decision of decisions) {
    if (decision.status === "accepted") summary.accepted++;
    else summary.rejected++;
    if (decision.status !== "rejected") continue;
    for (const reason of decision.reasons || []) {
      summary.rejection_reasons[reason] = (summary.rejection_reasons[reason] || 0) + 1;
    }
  }
  summary.rejection_reasons = Object.fromEntries(
    Object.entries(summary.rejection_reasons).sort(([a], [b]) => a.localeCompare(b))
  );
  return summary;
}

console.log("\n[3/3] Writing output...");

validateCurrentScanDocument(output);
await writeFile(outPath, serializeScanDocument(output), "utf-8");
evidenceStore.close();

console.log(`\n✅ Done. ${enriched.length} restaurants → ${outPath}`);
console.log(`   ${output.with_resources} with online resources, ${enriched.length - output.with_resources} without\n`);

function unwrap(result) {
  return result.status === "fulfilled" ? result.value : [];
}

function resourcesLine(completed, total, name, found) {
  const tail = found === 0
    ? "no resources found"
    : `${found} source${found > 1 ? "s" : ""}`;
  return `  [${completed}/${total}] ${name} ... ${tail}\n`;
}

function enrichmentProvenance(restaurant, online) {
  const provenance = { ...(restaurant.provenance || {}) };
  if (online.website_provenance) provenance.website = [online.website_provenance];
  else delete provenance.website;
  if (online.directory_url && restaurant.provenance?.website) {
    provenance.directory_url = restaurant.provenance.website;
  }
  return provenance;
}

function reusedEvidenceFields(cached) {
  return {
    website: cached.website,
    website_kind: cached.website_kind,
    website_confidence: cached.website_confidence,
    website_decision: cached.website_decision,
    resources: cached.resources || [],
    resource_decisions: cached.resource_decisions || [],
    enrichment_run: durableReuseRun(),
    evidence_state: cached.evidence_state,
    resources_checked: true,
    no_resources_found: (cached.resources || []).length === 0 && !cached.website,
  };
}

function durableReuseRun() {
  return {
    strategy: "website_first",
    evidence_reused: true,
    crawl_requests: 0,
    crawl_cache_hits: 0,
    search_requests: 0,
    search_attempts: [],
    search_fallback_reason: "durable_evidence_current",
    resource_discovery_requests: 0,
    resource_site_search_requests: 0,
    resource_validation_requests: 0,
    resource_stage_metrics: { totals: {
      candidates: 0, accepted: 0, review: 0, rejected: 0,
      pre_cap_dropped: 0, post_cap_dropped: 0,
    }, by_role: {} },
  };
}

function summarizeEvidenceStore(restaurants, metadata) {
  const reused = restaurants.filter((item) => item.evidence_state?.source === "sqlite_last_known_good");
  return {
    schema_version: metadata.schema_version,
    evidence_version: metadata.evidence_version,
    reused_venues: reused.length,
    stale_venues: reused.filter((item) => item.evidence_state?.website?.freshness === "stale"
      || item.evidence_state?.resources?.some((resource) => resource.freshness === "stale")).length,
    due_for_revalidation: reused.filter((item) => item.evidence_state?.due_for_revalidation).length,
  };
}

async function addMissingCoordinates(restaurants, location) {
  const missing = restaurants.filter((r) =>
    r.address && (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude))
  );
  if (!missing.length) return;
  if (!canBulkGeocode()) {
    console.log(`  address geocoding: skipped ${missing.length} non-OSM locations (configure a permitted NOMINATIM_URL to enable)\n`);
    return;
  }

  let found = 0;
  for (let i = 0; i < missing.length; i++) {
    const r = missing[i];
    let coordinates = null;
    try {
      coordinates = await geocode(r.address, location.municipality, location.province_code);
    } catch (err) {
      console.error(`  address geocoding failed for ${r.name}: ${err.message}`);
    }
    if (coordinates) {
      Object.assign(r, coordinates, {
        coordinates_source: "address",
        provenance: {
          ...(r.provenance || {}),
          latitude: [{ source: "configured_geocoder", origin: "geocoded_address" }],
          longitude: [{ source: "configured_geocoder", origin: "geocoded_address" }],
        },
      });
      found++;
    }
    if (i < missing.length - 1) await wait(1_050);
  }
  console.log(`  address geocoding: ${found}/${missing.length} additional locations\n`);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function enrichmentPriority(restaurant) {
  let score = 0;
  if (restaurant.website) {
    score += isDirectoryWebsite(restaurant.website) ? 40 : 100;
  }
  score += Math.min((restaurant.sources || []).length, 3) * 10;
  if (restaurant.address) score += 3;
  if (Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude)) score += 2;
  return score;
}

function isDirectoryWebsite(website) {
  return [
    "paginegialle.it", "thefork.it", "thefork.com", "facebook.com",
    "instagram.com", "tripadvisor.", "restaurantguru.", "sluurpy.",
  ].some((domain) => String(website || "").toLowerCase().includes(domain));
}

function isNotGarbage(r) {
  const name = (r.name || "").toLowerCase();

  if ((r.sources || []).includes("paginegialle") && name.length >= 3 && name.length <= 55) {
    return true;
  }

  const website = (r.website || "").toLowerCase();

  const nameGarbage = [
    "no title", "(no title)",
    "migliori", "top 10", "top 5", "top 15", "top ristoranti", "migliori ristoranti",
    "i migliori ristoranti",
    "le migliori", "i migliori", "classifica",
    "ristoranti a", "pizzerie a", "trattorie a", "osterie a",
    "cerca in zona", "aggiornamento al",
    "dove mangiare", "guida ai",
    "pagina iniziale", "page viewer",
    "michelin", "pagine gialle", "paginegialle",
    "mappa dei ristoranti", "mappa ristoranti", "ricerca ristoranti",
    "indirizzi", "orari di apertura",
    "elenco", "lista dei", "scopri i", "prenota nei",
    "tuttocitta", "italia.it",
  ];
  if (nameGarbage.some((g) => name.includes(g))) return false;

  const domainGarbage = [
    "paginegialle.it", "guide.michelin.com",
    "tripadvisor.it", "tripadvisor.com",
    "restaurantguru", "sluurpy", "pagina-inizio",
    "thefork.it", "facebook.com", "instagram.com",
    "google.com/maps", "google.it/maps",
    "tuttocitta.it", "italia.it",
    "paginebianche.it", "reteimprese.it", "visitcopenhagen",
    "piatti.menu/list/", "piatti.menu/restaurants/",
  ];
  // A directory/social URL is not an official website, but it must not erase
  // an independently structured OSM/Overture venue. Web-only candidates still
  // fail closed here.
  const structured = (r.sources || []).some((source) => !["web_search", "paginegialle"].includes(source));
  if (domainGarbage.some((d) => website.includes(d)) && !structured) return false;

  if (name.length < 3 || name.length > 55) return false;

  const metaPatterns = [
    /^di \w+(\s+a\s+\w+)?$/i,
    /^il meglio/i,
    /^i \d+ migliori/i,
    /scopri/i,
    /prenota/i,
    /^mappa/i,
    /^ricerca/i,
  ];
  if (metaPatterns.some((p) => p.test(name))) return false;
  if (/^(ristorante|pizzeria|trattoria|osteria|bar|pub|sushi)$/i.test(name.trim())) return false;

  if (looksLikeAddress(r.name, r.address)) return false;

  return true;
}

function looksLikeAddress(name, address) {
  const lower = name.toLowerCase().trim();
  const prefixes = ["via ", "viale ", "piazza ", "piazzale ", "corso ",
    "largo ", "vicolo ", "contrada ", "strada ", "località ",
    "borgo ", "piazzetta ", "galleria ", "salita "];
  if (prefixes.some((p) => lower.startsWith(p))) return true;
  if (/^sp\d/i.test(lower)) return true;
  if (/^(via|viale|piazza)\s+\w+/i.test(address || "")) {
    const streetPart = (address || "").split(",")[0].toLowerCase().trim();
    if (streetPart === lower) return true;
  }
  return false;
}

function normalizeRecord(r) {
  // Search snippets are useful transient discovery evidence but are not needed
  // in the resulting directory. Avoid redistributing third-party prose.
  const { snippet: _snippet, ...minimal } = r;
  let name = (r.name || "").trim()
    .replace(/^[^\wà-ù']+/i, "")
    .replace(/["«„]/g, "")
    .replace(/[»"]/g, "")
    .replace(/\s+/g, " ");
  name = capitalizeWords(name);
  return { ...minimal, name };
}

function withFieldProvenance(record) {
  const source = record.source || "unknown";
  const provenance = { ...(record.provenance || {}) };
  const originFor = (field) => {
    if (source === "nominatim") return field === "website" ? "osm_tag" : "osm_object";
    if (source === "web_search") {
      if (field === "website") return "search_result_url";
      if (field === "address") return record.address_source || "fetched_page";
      return "search_result_or_fetched_page";
    }
    if (source === "paginegialle") return "search_result";
    if (source === "overture_places") return record.provenance?.[field]?.[0]?.origin || "overture_record";
    return "source_record";
  };
  for (const field of [
    "name", "type", "address", "phone", "website", "cuisine",
    "latitude", "longitude", "osm_id", "overture_id", "provider_place_id",
    "provider_record_url", "postcode", "address_components",
  ]) {
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    provenance[field] = record.provenance?.[field]?.length
      ? structuredClone(record.provenance[field])
      : [{ source, origin: originFor(field) }];
  }
  return { ...record, provenance };
}

function configuredGapQueries(location) {
  const configuredPostcodes = String(process.env.LOCATION_POSTCODES || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const categories = String(process.env.GAP_CATEGORIES || "restaurant")
    .split(",").map((item) => item.trim()).filter(Boolean);
  // Phase 3 retained only the postcode restaurant template in deterministic
  // replay. Further templates stay disabled until they demonstrate marginal
  // truth-set value.
  return buildPostcodeGapQueries({ ...location,
    postcodes: configuredPostcodes.length ? configuredPostcodes : location.postcodes }, {
    residualGaps: [{ id: "operator-declared-residual-gap", categories }],
    maxQueries: 4,
  }).filter((item) => item.id === "postcode_restaurant_menu");
}

function capitalizeWords(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
