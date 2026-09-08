#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { get, getRendered } from "./lib/lib.mjs";
import { findMenuSources } from "./find-menu.mjs";

const MAX_VENUES = 50;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function enrichSelectedAttested(options = {}, dependencies = {}) {
  const dbPath = resolve(String(options.dbPath || ""));
  if (!options.dbPath || !existsSync(dbPath)) throw new Error("existing --db PATH is required");
  const venueIds = [...new Set((options.venueIds || []).map((item) => String(item).trim()).filter(Boolean))];
  if (!venueIds.length) throw new Error("at least one --venue ID is required");
  if (venueIds.length > MAX_VENUES) throw new Error(`selected crawl is capped at ${MAX_VENUES} venues`);
  const cacheDir = resolve(String(options.cacheDir || resolve(tmpdir(), "restaurant-finder-attested-cache")));
  const force = options.force === true;
  const store = new EvidenceStore(dbPath);
  try {
    const selected = venueIds.map((venueId) => loadVenue(store, venueId));
    for (const venue of selected) {
      venue.publisher_ownership = store.publisherOwnershipForVenue(venue);
      if (!venue.publisher_ownership.length) {
        throw new Error(`venue ${venue.canonical_venue_id} has no active publisher attestation`);
      }
    }
    const results = [];
    for (const venue of selected) {
      const reusable = store.findReusableEvidence(venue, { municipality: venue.municipality });
      if (!force && reusable && !reusable.due_for_revalidation) {
        results.push({ venue_id: venue.canonical_venue_id, status: "reused",
          website: reusable.website, resources: reusable.resources?.length || 0 });
        continue;
      }
      const location = {
        municipality: venue.municipality,
        province_code: venue.province_code || "",
        region_code: venue.region_code || "",
        postcodes: venue.postcode ? [venue.postcode] : [],
      };
      const enrichment = await (dependencies.enrich || findMenuSources)(venue, location, {
        get: dependencies.get || ((url, requestOptions) =>
          get(url, { ...requestOptions, cacheDir })),
        getRendered: dependencies.getRendered || getRendered,
        resolverBudget: { searches: 0, crawls: 3 },
        resourceBudget: { validations: 4, sitemaps: 1, siteSearch: false },
      });
      store.recordEnrichment(venue, enrichment, { location });
      results.push({
        venue_id: venue.canonical_venue_id,
        status: enrichment.website ? "accepted" : enrichment.enrichment_run?.resolver_status || "abstained",
        website: enrichment.website || null,
        resources: enrichment.resources?.length || 0,
        search_requests: enrichment.enrichment_run?.search_requests || 0,
        resource_site_search_requests: enrichment.enrichment_run?.resource_site_search_requests || 0,
        crawl_requests: enrichment.enrichment_run?.crawl_requests || 0,
        stop_reason: enrichment.enrichment_run?.resolver_stop_reason || null,
      });
    }
    return { database: dbPath, cache_directory: cacheDir, selected: venueIds.length,
      accepted: results.filter((item) => item.status === "accepted").length,
      reused: results.filter((item) => item.status === "reused").length,
      search_requests: results.reduce((sum, item) => sum + (item.search_requests || 0), 0),
      resource_site_search_requests: results.reduce((sum, item) =>
        sum + (item.resource_site_search_requests || 0), 0),
      results };
  } finally {
    store.close();
  }
}

function loadVenue(store, venueId) {
  const row = store.db.prepare("SELECT * FROM venues WHERE venue_id = ? AND lifecycle_status = 'active'")
    .get(venueId);
  if (!row) throw new Error(`active venue ${venueId} not found`);
  const records = store.db.prepare(`SELECT payload_json FROM source_records
    WHERE venue_id = ? ORDER BY source_record_id`).all(venueId)
    .map((item) => JSON.parse(item.payload_json));
  if (!records.length) throw new Error(`source records missing for venue ${venueId}`);
  const aliases = store.db.prepare("SELECT alias FROM venue_aliases WHERE venue_id = ? ORDER BY alias")
    .all(venueId).map((item) => item.alias);
  const primary = records[0];
  return { ...primary, canonical_venue_id: venueId, name: row.display_name,
    municipality: primary.municipality || row.municipality,
    website: primary.website || undefined,
    aliases: [...new Set(aliases)], source_records: records };
}

function parseArgs(argv) {
  const parsed = { venueIds: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--force") { parsed.force = true; continue; }
    if (item === "--venue") { parsed.venueIds.push(argumentValue(argv, ++index, item)); continue; }
    if (item === "--db") { parsed.dbPath = argumentValue(argv, ++index, item); continue; }
    if (item === "--cache-dir") { parsed.cacheDir = argumentValue(argv, ++index, item); continue; }
    if (item === "--help" || item === "-h") { parsed.help = true; continue; }
    throw new Error(`unknown argument: ${item}`);
  }
  return parsed;
}

function argumentValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function usage() {
  return `Usage: node enrich-attested.mjs --db PATH --venue ID [--venue ID ...]
       [--cache-dir PATH] [--force]

Crawl at most ${MAX_VENUES} explicitly selected, actively attested venues.
Search is hard-disabled. Existing fresh facts are reused unless --force is set.`;
}

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(usage());
    else console.log(JSON.stringify(await enrichSelectedAttested(args), null, 2));
  } catch (error) {
    console.error(`enrich-attested: ${error.message}`);
    process.exitCode = 1;
  }
}
