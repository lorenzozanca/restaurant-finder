const PROVINCE_CODE = /^[A-Z]{2}$/;

export function resolveMunicipalityMetadata(requested, catalog) {
  const municipality = clean(requested?.municipality);
  const requestedProvince = clean(requested?.province_code).toUpperCase();
  const matches = (catalog?.towns || []).filter(([name]) => normalize(name) === normalize(municipality));
  if (!matches.length) return { municipality, province_code: requestedProvince };
  const exact = requestedProvince ? matches.find(([, code]) => code === requestedProvince) : null;
  if (requestedProvince && !exact) {
    throw new Error(`${municipality} is not in province ${requestedProvince}`);
  }
  if (!requestedProvince && matches.length > 1) {
    throw new Error(`${municipality} is ambiguous; provide a province code`);
  }
  const [canonicalName, provinceCode] = exact || matches[0];
  const province = (catalog.provinces || []).find(([code]) => code === provinceCode)?.[1];
  return { municipality: canonicalName, province_code: provinceCode, province };
}

export function createLocationContext(requested = {}, resolvedPlace = {}) {
  const municipality = clean(requested.municipality
    || resolvedPlace.address?.city || resolvedPlace.address?.town
    || resolvedPlace.address?.village || resolvedPlace.name);
  const provinceCode = clean(requested.province_code).toUpperCase();
  const bbox = normalizeNominatimBbox(resolvedPlace.boundingbox)
    || normalizeBbox(requested.bbox);
  const centroid = coordinates(resolvedPlace.lat, resolvedPlace.lon)
    || normalizeCentroid(requested.centroid) || bboxCentroid(bbox);
  const postcodes = unique([
    ...(requested.postcodes || []),
    resolvedPlace.address?.postcode,
  ].flatMap(splitPostcodes).map(clean));
  const relationId = resolvedPlace.osm_type === "relation" && resolvedPlace.osm_id
    ? String(resolvedPlace.osm_id) : clean(requested.osm_relation_id);

  const context = compact({
    municipality,
    province_code: provinceCode || undefined,
    province: clean(requested.province || resolvedPlace.address?.county) || undefined,
    region: clean(requested.region || resolvedPlace.address?.state) || undefined,
    country_code: clean(requested.country_code || resolvedPlace.address?.country_code || "IT").toUpperCase(),
    postcodes,
    centroid,
    bbox,
    osm_relation_id: relationId || undefined,
  });
  return validateLocationContext(context);
}

export function normalizeLocationContext(value, province = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return createLocationContext(value);
  }
  const raw = clean(value);
  const explicitProvince = clean(province).toUpperCase();
  if (explicitProvince) {
    return createLocationContext({ municipality: raw, province_code: explicitProvince });
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const trailing = parts.at(-1)?.toUpperCase();
  const provinceCode = PROVINCE_CODE.test(trailing || "") ? trailing : "";
  return createLocationContext({
    municipality: provinceCode ? parts.slice(0, -1).join(" ") : raw,
    province_code: provinceCode,
  });
}

export function validateLocationContext(value) {
  if (!value?.municipality) throw new Error("LocationContext requires a municipality");
  if (value.province_code && !PROVINCE_CODE.test(value.province_code)) {
    throw new Error("LocationContext province_code must be a two-letter code");
  }
  if (value.country_code && !PROVINCE_CODE.test(value.country_code)) {
    throw new Error("LocationContext country_code must be a two-letter code");
  }
  if (!Array.isArray(value.postcodes)) throw new Error("LocationContext postcodes must be an array");
  if (value.bbox && !normalizeBbox(value.bbox)) throw new Error("LocationContext bbox is invalid");
  if (value.centroid && !normalizeCentroid(value.centroid)) throw new Error("LocationContext centroid is invalid");
  return value;
}

export function locationDisplay(value) {
  const location = normalizeLocationContext(value);
  return [location.municipality, location.province_code].filter(Boolean).join(" ");
}

function normalizeNominatimBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [south, north, west, east] = value.map(Number);
  return normalizeBbox([west, south, east, north]);
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [west, south, east, north] = value.map(Number);
  if (![west, south, east, north].every(Number.isFinite)
      || west >= east || south >= north
      || west < -180 || east > 180 || south < -90 || north > 90) return null;
  return [west, south, east, north];
}

function normalizeCentroid(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return coordinates(latitude, longitude);
}

function coordinates(latitudeValue, longitudeValue) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function bboxCentroid(bbox) {
  if (!bbox) return null;
  return { longitude: (bbox[0] + bbox[2]) / 2, latitude: (bbox[1] + bbox[3]) / 2 };
}

function splitPostcodes(value) {
  return String(value || "").split(/[;,\s]+/).filter(Boolean);
}
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function clean(value) { return String(value || "").trim(); }
function normalize(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}
