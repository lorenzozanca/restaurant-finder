import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { sourceResult } from "../source-run.mjs";
import { normalizeLocationContext } from "../lib/location-context.mjs";

const FOOD_CATEGORIES = new Map([
  ["restaurant", "restaurant"],
  ["italian_restaurant", "restaurant"],
  ["pizza_restaurant", "pizzeria"],
  ["pizzeria", "pizzeria"],
  ["cafe", "cafe"],
  ["coffee_shop", "cafe"],
  ["bar", "bar"],
  ["pub", "pub"],
  ["fast_food_restaurant", "fast food"],
  ["ice_cream_shop", "ice cream"],
  ["gelato_shop", "ice cream"],
  ["food_court", "food court"],
]);
const MIN_PLACE_CONFIDENCE = 0.9;

export async function discover(locationValue, province = "", options = {}) {
  if (province && typeof province === "object") { options = province; province = ""; }
  const location = normalizeLocationContext(locationValue, province);
  const filePath = options.filePath || process.env.OVERTURE_PLACES_PATH;
  if (!filePath) throw new Error("OVERTURE_PLACES_PATH is not configured");
  const imported = await importOverturePlaces(filePath, {
    ...location,
    bbox: options.bbox || location.bbox,
    postcodes: options.postcodes || location.postcodes,
  });
  return {
    ...sourceResult(imported.items, {
      status: "succeeded",
      useful_result_count: imported.items.length,
      import_report: imported.report,
    }),
    import_report: imported.report,
    location: imported.location,
  };
}

// The pilot accepts newline-delimited GeoJSON/JSON records and GeoJSON feature
// collections exported from Overture GeoParquet. Keeping conversion outside
// the scanner lets a large national dataset remain local and bbox-filtered.
export async function importOverturePlaces(filePath, requestedLocation = {}) {
  const absolutePath = resolve(filePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = parseLocalExtract(raw, extname(absolutePath));
  const metadata = parsed.metadata || {};
  const location = normalizeLocation(requestedLocation, metadata);
  assertLocationMatches(location, metadata);
  const bbox = normalizeBbox(requestedLocation.bbox || metadata.bbox);
  if (!bbox) throw new Error("Overture extract is missing a valid bbox");

  const items = [];
  const dropped = {};
  for (const value of parsed.records) {
    const mapped = mapOverturePlace(value, { ...location, bbox });
    if (!mapped.item) {
      dropped[mapped.reason] = (dropped[mapped.reason] || 0) + 1;
      continue;
    }
    items.push(mapped.item);
  }
  items.sort((a, b) => a.overture_id.localeCompare(b.overture_id));
  return {
    items,
    location: { ...location, bbox },
    report: {
      source: "overture_places",
      input_records: parsed.records.length,
      accepted_records: items.length,
      dropped_records: parsed.records.length - items.length,
      dropped_by_reason: Object.fromEntries(Object.entries(dropped).sort()),
      bbox,
    },
  };
}

export function mapOverturePlace(value, location) {
  const feature = value?.type === "Feature" ? value : null;
  const record = feature?.properties || value || {};
  const id = clean(record.id || feature?.id);
  if (!id) return rejected("missing_stable_id");

  const coordinates = extractCoordinates(feature?.geometry || record.geometry);
  if (!coordinates) return rejected("missing_geometry");
  const [longitude, latitude] = coordinates;
  if (!insideBbox(longitude, latitude, location.bbox)) return rejected("outside_bbox");

  // Overture's primary category is authoritative for admission. A non-food
  // place can carry a noisy food alternate (for example a car-parts shop with
  // `ice_cream_shop`, or a parking area with `bar`). Alternates refine an
  // already-food primary category; they must not turn a non-food primary into
  // a venue.
  const primaryCategory = normalizeCategory(record.categories?.primary
    || (typeof record.categories === "string" ? record.categories : ""));
  const primaryFoodType = FOOD_CATEGORIES.get(primaryCategory);
  const category = primaryCategory
    ? (primaryFoodType ? [primaryCategory, primaryFoodType] : null)
    : categoryValues(record.categories)
      .map((item) => [item, FOOD_CATEGORIES.get(item)])
      .find(([, mapped]) => mapped);
  if (!category) return rejected("non_food_category");

  const name = extractName(record.names);
  if (!name) return rejected("missing_name");
  const confidence = finiteNumber(record.confidence);
  if (confidence !== undefined && confidence < MIN_PLACE_CONFIDENCE) {
    return rejected("low_confidence");
  }
  const address = extractAddress(record.addresses);
  const localEvidence = localAddressEvidence(address, location);
  if (localEvidence.contradiction) return rejected("address_contradiction");

  const website = firstString(record.websites);
  const phone = firstString(record.phones);
  const sourceUrl = providerRecordUrl(record, id);
  const item = {
    name,
    type: category[1],
    address: formatAddress(address),
    address_components: compact({
      street: address.street,
      house_number: address.house_number,
      locality: address.locality,
      postcode: address.postcode,
      region: address.region,
      country_code: address.country_code,
    }),
    postcode: address.postcode || undefined,
    latitude,
    longitude,
    coordinates_source: "overture_geometry",
    website: website || undefined,
    phone: phone || undefined,
    confidence,
    overture_id: id,
    provider_place_id: id,
    provider_record_url: sourceUrl,
    source: "overture_places",
    municipality: location.municipality || undefined,
    istat_municipality_code: location.spatial_assignment?.istat_code || undefined,
    province_code: location.province_code || undefined,
    region_code: location.spatial_assignment?.region_code || undefined,
    aliases: localNameAliases(name, location.municipality),
    provenance: overtureProvenance(id, sourceUrl, category[0], localEvidence.evidence,
      location.spatial_assignment),
  };
  return { item: compact(item) };
}

function localNameAliases(name, municipality) {
  const suffix = clean(municipality);
  const original = clean(name);
  const aliases = [];
  const add = (value) => {
    const alias = clean(value);
    if (alias && normalize(alias) !== normalize(original)
        && !aliases.some((item) => normalize(item) === normalize(alias))) aliases.push(alias);
  };
  const municipalityFree = suffix
    ? original.replace(new RegExp(`\\s+${escapeRegex(suffix)}$`, "iu"), "").trim()
    : original;
  add(municipalityFree);
  const venueType = "(?:ristorante|pizzeria|trattoria|osteria|bar|pub|caffe|caffè)";
  const prefixFree = municipalityFree.replace(new RegExp(`^${venueType}\\s+`, "iu"), "");
  const suffixFree = municipalityFree.replace(new RegExp(`(?:\\s+${venueType})+$`, "iu"), "");
  add(prefixFree);
  add(suffixFree);
  add(municipalityFree.replace(/\bquattro\b/giu, "4"));
  add(prefixFree.replace(/\bquattro\b/giu, "4"));
  add(suffixFree.replace(/[’']/gu, ""));
  // Overture sometimes carries the conventional Roman-capital V spelling.
  add(municipalityFree.replace(/ivs\b/giu, "ius"));
  return aliases;
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function parseLocalExtract(raw, extension) {
  const text = raw.trim();
  if (!text) return { records: [], metadata: {} };
  if (extension === ".jsonl" || extension === ".geojsonl" || extension === ".ndjson") {
    const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return { records, metadata: {} };
  }
  const value = JSON.parse(text);
  if (value?.type === "FeatureCollection") {
    return { records: value.features || [], metadata: value.metadata || { bbox: value.bbox } };
  }
  if (Array.isArray(value)) return { records: value, metadata: {} };
  if (Array.isArray(value?.places)) return { records: value.places, metadata: value.metadata || {} };
  throw new Error("unsupported Overture extract JSON shape");
}

function normalizeLocation(requested, metadata) {
  return {
    municipality: clean(requested.municipality || metadata.municipality),
    province_code: clean(requested.province_code || metadata.province_code).toUpperCase(),
    country_code: clean(requested.country_code || metadata.country_code || "IT").toUpperCase(),
    postcodes: unique([...(requested.postcodes || []), ...(metadata.postcodes || [])].map(clean)),
  };
}

function assertLocationMatches(requested, metadata) {
  for (const field of ["municipality", "province_code", "country_code"]) {
    if (requested[field] && metadata[field]
        && normalize(requested[field]) !== normalize(metadata[field])) {
      throw new Error(`Overture extract ${field} does not match the requested location`);
    }
  }
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map(Number);
  if (!bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null;
  if (bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) return null;
  return bbox;
}

function extractCoordinates(geometry) {
  if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const coordinates = geometry.coordinates.slice(0, 2).map(Number);
  return coordinates.length === 2 && coordinates.every(Number.isFinite) ? coordinates : null;
}

function insideBbox(longitude, latitude, bbox) {
  return longitude >= bbox[0] && longitude <= bbox[2]
    && latitude >= bbox[1] && latitude <= bbox[3];
}

function categoryValues(categories) {
  if (typeof categories === "string") return [normalizeCategory(categories)];
  if (Array.isArray(categories)) return categories.map(normalizeCategory);
  return [categories?.primary, ...(categories?.alternate || [])]
    .filter(Boolean).map(normalizeCategory);
}

function normalizeCategory(value) {
  return clean(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function extractName(names) {
  if (typeof names === "string") return clean(names);
  const primary = typeof names?.primary === "string" ? names.primary : names?.primary?.name;
  if (primary) return clean(primary);
  const common = names?.common;
  if (Array.isArray(common)) return clean(common.find((item) => item?.language === "it")?.value
    || common[0]?.value || common[0]);
  return "";
}

function extractAddress(addresses) {
  const raw = Array.isArray(addresses) ? addresses[0] : addresses || {};
  return {
    street: clean(raw.street || raw.address_line || raw.freeform),
    house_number: clean(raw.house_number),
    locality: clean(raw.locality || raw.locality_name || raw.city),
    postcode: clean(raw.postcode || raw.postal_code),
    region: clean(raw.region || raw.region_code),
    country_code: clean(raw.country_code || raw.country).toUpperCase(),
  };
}

function localAddressEvidence(address, location) {
  const evidence = ["geometry_inside_bbox"];
  let contradiction = false;
  if (location.spatial_assignment?.istat_code) {
    evidence.push(`geometry_inside_istat_municipality:${location.spatial_assignment.istat_code}`);
  }
  if (address.locality) {
    if (normalize(address.locality) === normalize(location.municipality)) evidence.push("municipality_exact");
    else if (location.spatial_assignment) evidence.push("source_locality_differs_from_spatial_assignment");
    else contradiction = true;
  }
  if (address.postcode) {
    if ((location.postcodes || []).includes(address.postcode)) evidence.push("postcode_exact");
    else if ((location.postcodes || []).length) contradiction = true;
  }
  if (address.country_code && location.country_code
      && address.country_code !== location.country_code) contradiction = true;
  return { evidence, contradiction };
}

function formatAddress(address) {
  const street = [address.street, address.house_number].filter(Boolean).join(" ");
  const place = [address.postcode, address.locality].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

function providerRecordUrl(record, id) {
  const explicit = clean(record.provider_record_url);
  if (explicit) return explicit;
  const source = (record.sources || []).find((item) => item?.record_id || item?.dataset);
  return clean(source?.record_id || source?.dataset) || `overture:${id}`;
}

function overtureProvenance(id, sourceUrl, category, localEvidence, spatialAssignment) {
  const fact = (origin) => [{ source: "overture_places", origin, provider_place_id: id,
    provider_record_url: sourceUrl }];
  const provenance = {
    name: fact("overture_names"), type: fact(`overture_category:${category}`),
    address: fact("overture_address"), postcode: fact("overture_address"),
    latitude: fact("overture_geometry"), longitude: fact("overture_geometry"),
    website: fact("overture_website"), phone: fact("overture_phone"),
    overture_id: fact("overture_stable_id"), provider_place_id: fact("overture_stable_id"),
    provider_record_url: fact("overture_source_reference"),
    local_evidence: fact(localEvidence.join("+")),
  };
  if (spatialAssignment?.istat_code) {
    const boundaryFact = [{ source: "istat_boundaries", origin: "point_in_polygon",
      istat_municipality_code: spatialAssignment.istat_code,
      boundary_reference_date: spatialAssignment.reference_date,
      boundary_sha256: spatialAssignment.boundary_sha256 }];
    provenance.municipality = boundaryFact;
    provenance.istat_municipality_code = boundaryFact;
    provenance.province_code = boundaryFact;
    provenance.region_code = boundaryFact;
  }
  return provenance;
}

function firstString(value) {
  if (Array.isArray(value)) return clean(value.find((item) => typeof item === "string") || value[0]?.value);
  return clean(value?.value || value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== undefined && item !== null && item !== ""));
}

function clean(value) { return String(value || "").trim(); }
function normalize(value) {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function rejected(reason) { return { item: null, reason }; }
