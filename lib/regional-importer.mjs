import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { canonicalizeVenues } from "./identity.mjs";
import { assignMunicipality, createMunicipalityIndex,
  loadMunicipalityBoundaries } from "./municipality-boundaries.mjs";
import { EnrichmentQueue } from "./enrichment-queue.mjs";
import { mapOverturePlace } from "../sources/overture-places.mjs";

export async function importRegionalOverture(options = {}) {
  requireOption(options.placesPath, "placesPath");
  requireOption(options.boundariesPath, "boundariesPath");
  const regionCode = normalizeRegionCode(options.regionCode);
  const placesSha256 = await sha256File(options.placesPath);
  const boundariesSha256 = await sha256File(options.boundariesPath);
  assertChecksum("Overture places", placesSha256, options.expectedPlacesSha256);
  assertChecksum("ISTAT boundaries", boundariesSha256, options.expectedBoundariesSha256);

  const loaded = await loadMunicipalityBoundaries(options.boundariesPath,
    regionCode ? { regionCode } : {});
  const index = createMunicipalityIndex(loaded.municipalities);
  const regionalBbox = combinedBbox(loaded.municipalities);
  const byMunicipality = new Map();
  const dropped = {};
  let inputRecords = 0;
  let acceptedRecords = 0;
  for await (const value of readGeoJsonSequence(options.placesPath)) {
    inputRecords++;
    const preliminary = mapOverturePlace(value, {
      country_code: "IT", bbox: regionalBbox,
      spatial_assignment: { istat_code: "prefilter" },
    });
    if (!preliminary.item) {
      increment(dropped, preliminary.reason === "outside_bbox"
        ? (regionCode ? "outside_region_bbox" : "outside_country_bbox") : preliminary.reason);
      continue;
    }
    const assignment = assignMunicipality(preliminary.item.longitude, preliminary.item.latitude, index);
    if (assignment.status !== "assigned") {
      increment(dropped, assignment.status);
      continue;
    }
    const municipality = assignment.municipality;
    const mapped = mapOverturePlace(value, {
      municipality: municipality.municipality,
      province_code: municipality.province_code,
      country_code: "IT",
      bbox: municipality.bbox,
      spatial_assignment: {
        istat_code: municipality.istat_code,
        region_code: municipality.region_code,
        reference_date: loaded.metadata.administrative_reference_date || loaded.metadata.reference_date,
        boundary_sha256: boundariesSha256,
      },
    });
    if (!mapped.item) {
      increment(dropped, mapped.reason);
      continue;
    }
    if (!byMunicipality.has(municipality.istat_code)) {
      byMunicipality.set(municipality.istat_code, { municipality, records: [] });
    }
    byMunicipality.get(municipality.istat_code).records.push(mapped.item);
    acceptedRecords++;
    options.onProgress?.({ input_records: inputRecords, accepted_records: acceptedRecords });
  }

  const canonical = [];
  const municipalityInventory = [];
  for (const { municipality, records } of [...byMunicipality.values()]
    .sort((left, right) => left.municipality.istat_code.localeCompare(right.municipality.istat_code))) {
    const location = regionCode ? municipality.municipality : {
      municipality: municipality.municipality,
      canonical_namespace: municipality.istat_code,
    };
    const venues = canonicalizeVenues(records, { location });
    canonical.push(...venues);
    municipalityInventory.push(inventoryRow(municipality, records, venues));
  }
  canonical.sort((left, right) => left.canonical_venue_id.localeCompare(right.canonical_venue_id));

  let durable = null;
  if (options.storePath) {
    durable = ingestDurably(canonical, options, {
      placesSha256, boundariesSha256, boundaryMetadata: loaded.metadata,
    });
  }
  const inventory = {
    input_records: inputRecords,
    accepted_source_records: acceptedRecords,
    canonical_venues: canonical.length,
    duplicate_source_records: acceptedRecords - canonical.length,
    municipalities_with_venues: municipalityInventory.length,
    boundary_municipalities: loaded.municipalities.length,
    websites: canonical.filter((venue) => venue.website).length,
    website_coverage: canonical.length ? round(canonical.filter((venue) => venue.website).length / canonical.length) : 0,
    by_type: countBy(canonical, (venue) => venue.type || "unknown"),
    by_region: regionInventory(municipalityInventory, loaded.municipalities),
    by_municipality: municipalityInventory,
    dropped_records: inputRecords - acceptedRecords,
    dropped_by_reason: Object.fromEntries(Object.entries(dropped).sort()),
  };
  const fingerprint = createHash("sha256").update(stableJson({ inventory,
    venue_ids: canonical.map((venue) => venue.canonical_venue_id) })).digest("hex");
  return {
    manifest: {
      importer_version: 1,
      scope: regionCode ? "regional" : "national",
      country_code: "IT",
      region_code: regionCode,
      region: regionCode ? loaded.metadata.region || null : null,
      overture: {
        path: options.placesPath, sha256: placesSha256,
        release: options.overtureRelease || "unknown",
      },
      boundaries: {
        path: options.boundariesPath, sha256: boundariesSha256,
        source: loaded.metadata.source || "ISTAT administrative boundaries",
        geometry_reference_date: loaded.metadata.reference_date || "unknown",
        reference_date: loaded.metadata.administrative_reference_date
          || loaded.metadata.reference_date || "unknown",
        crs: loaded.metadata.crs || "EPSG:4326",
      },
      inventory_fingerprint: fingerprint,
      queue: durable,
    },
    inventory,
    venues: options.includeVenues === false ? undefined : canonical,
  };
}

export async function* readGeoJsonSequence(filePath) {
  // `readline` also treats U+2028/U+2029 as line boundaries. Those code points
  // are legal inside JSON strings and occur in real Overture URL fields, while
  // GeoJSONSeq uses the LF byte as its record delimiter. Split on LF only.
  const input = createReadStream(filePath, { encoding: "utf8" });
  let lineNumber = 0;
  let buffered = "";
  for await (const chunk of input) {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      lineNumber++;
      if (!line.trim()) continue;
      try { yield JSON.parse(line); }
      catch (error) { throw invalidRecord(filePath, lineNumber, error); }
    }
  }
  if (buffered) {
    lineNumber++;
    const line = buffered.replace(/\r$/, "");
    if (!line.trim()) return;
    try { yield JSON.parse(line); }
    catch (error) { throw invalidRecord(filePath, lineNumber, error); }
  }
}

function invalidRecord(filePath, lineNumber, error) {
  return new Error(`${filePath}:${lineNumber}: invalid GeoJSONSeq record: ${error.message}`);
}

function ingestDurably(venues, options, source) {
  const queue = new EnrichmentQueue(options.storePath);
  let run = options.runId ? queue.getRun(options.runId) : null;
  if (run && !["running", "completed"].includes(run.status)) {
    queue.close();
    throw new Error(`import run ${run.run_id} is ${run.status}; use a new runId`);
  }
  run ||= queue.createRun({
    runId: options.runId,
    codeVersion: options.codeVersion || "working-tree",
    scoringVersion: options.scoringVersion || "identity-v2",
    configuration: { offline_import: true, enqueue: options.enqueue !== false,
      overture_release: options.overtureRelease || "unknown",
      places_sha256: source.placesSha256, boundaries_sha256: source.boundariesSha256,
      boundary_reference_date: source.boundaryMetadata.administrative_reference_date
        || source.boundaryMetadata.reference_date },
    sourceHealth: { overture_places: "offline_verified", istat_boundaries: "offline_verified" },
  });
  let enqueued = 0;
  queue.store.transaction(() => {
    for (const venue of venues) {
      queue.store.rememberVenue(venue, { municipality: venue.municipality });
      if (options.enqueue === false) continue;
      queue.enqueue({
        venue, municipality: venue.municipality, runId: run.run_id,
        stage: "website_and_resources", priority: venue.website ? 20 : 10,
        revision: `${options.overtureRelease || "unknown"}:${source.boundaryMetadata.administrative_reference_date
          || source.boundaryMetadata.reference_date || "unknown"}:identity-v2`,
        domain: venue.website || "",
        payload: { municipality: venue.municipality,
          istat_municipality_code: venue.istat_municipality_code,
          known_website: venue.website || null },
      });
      enqueued++;
    }
  });
  if (run.status === "running") queue.finishRun(run.run_id, { sourceHealth: {
      overture_places: "offline_verified", istat_boundaries: "offline_verified",
    } });
  const result = { store_path: options.storePath, run_id: run.run_id,
    remembered_venues: venues.length, enqueued_jobs: enqueued, status: queue.status() };
  queue.close();
  return result;
}

function inventoryRow(municipality, records, venues) {
  return {
    istat_code: municipality.istat_code,
    municipality: municipality.municipality,
    province_code: municipality.province_code,
    region_code: municipality.region_code,
    region: municipality.region,
    source_records: records.length,
    canonical_venues: venues.length,
    duplicates: records.length - venues.length,
    websites: venues.filter((venue) => venue.website).length,
    by_type: countBy(venues, (venue) => venue.type || "unknown"),
  };
}

function regionInventory(municipalities, boundaries) {
  const rows = new Map();
  for (const boundary of boundaries) {
    if (!rows.has(boundary.region_code)) rows.set(boundary.region_code, {
      region_code: boundary.region_code, region: boundary.region,
      boundary_municipalities: 0, municipalities_with_venues: 0,
      source_records: 0, canonical_venues: 0, duplicates: 0, websites: 0,
    });
    rows.get(boundary.region_code).boundary_municipalities++;
  }
  for (const municipality of municipalities) {
    const row = rows.get(municipality.region_code);
    row.municipalities_with_venues++;
    row.source_records += municipality.source_records;
    row.canonical_venues += municipality.canonical_venues;
    row.duplicates += municipality.duplicates;
    row.websites += municipality.websites;
  }
  return [...rows.values()].sort((left, right) => left.region_code.localeCompare(right.region_code));
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function assertChecksum(label, actual, expected) {
  if (expected && actual !== String(expected).toLowerCase()) {
    throw new Error(`${label} checksum mismatch: expected ${expected}, received ${actual}`);
  }
}
function combinedBbox(municipalities) {
  return municipalities.reduce((bbox, item) => [Math.min(bbox[0], item.bbox[0]),
    Math.min(bbox[1], item.bbox[1]), Math.max(bbox[2], item.bbox[2]),
    Math.max(bbox[3], item.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
}
function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) increment(counts, keyFor(value));
  return Object.fromEntries(Object.entries(counts).sort());
}
function increment(target, key) { target[key] = (target[key] || 0) + 1; }
function round(value) { return Math.round(value * 10_000) / 10_000; }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function requireOption(value, name) { if (!value) throw new TypeError(`${name} is required`); }
function normalizeRegionCode(value) {
  if (value === undefined || value === null || value === "") return null;
  const code = String(value).padStart(2, "0");
  if (!/^\d{2}$/.test(code) || code === "00") {
    throw new TypeError("regionCode must be a two-digit ISTAT code when provided");
  }
  return code;
}
