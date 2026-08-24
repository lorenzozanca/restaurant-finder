import { get } from "../lib/lib.mjs";

const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_URL = stripTrailingSlash(
  process.env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL
);
const OVERPASS_URL = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL;
const UA = process.env.OSM_USER_AGENT || "restaurant-finder/0.2 (OpenStreetMap venue discovery)";

const VALID_TYPES = new Set([
  "restaurant", "cafe", "bar", "pub", "fast_food", "food_court",
  "biergarten", "ice_cream",
]);

// Nominatim resolves the one location explicitly requested by the user.
// Overpass then performs the job it was designed for: selecting OSM objects
// inside that location. This avoids systematic POI searches on public
// Nominatim while retaining OpenStreetMap venue discovery.
export async function discover(town, province = "") {
  const location = await locateTown(town, province);
  if (!location) {
    console.error(`[openstreetmap] could not resolve town "${town}"`);
    return [];
  }

  const query = buildOverpassQuery(location);
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await get(url, {
    timeout: 60_000,
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    console.error(`[overpass] HTTP ${res.status} while looking up venues in "${town}"`);
    return [];
  }

  try {
    const data = JSON.parse(res.body);
    if (!Array.isArray(data.elements)) return [];
    return data.elements.map(formatElement).filter(Boolean);
  } catch {
    console.error(`[overpass] JSON parse failed while looking up venues in "${town}"`);
    return [];
  }
}

// Automated address-by-address geocoding is not sent to the public Nominatim
// endpoint. Deployments that configure their own or a contracted endpoint can
// retain coordinate enrichment for records discovered from other sources.
export function canBulkGeocode(url = NOMINATIM_URL) {
  return !isPublicNominatim(url);
}

export async function geocode(address, town, province = "") {
  if (!canBulkGeocode()) return null;

  const query = [address, town, province, "Italy"].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
    countrycodes: "it",
  });
  const data = await queryNominatim(params);
  const place = data[0];
  if (!place) return null;

  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

async function locateTown(town, province) {
  const params = new URLSearchParams({
    q: [town, province, "Italy"].filter(Boolean).join(", "),
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
    countrycodes: "it",
    "accept-language": "it",
  });
  const results = await queryNominatim(params);
  return chooseTownResult(results);
}

async function queryNominatim(params) {
  const res = await get(`${NOMINATIM_URL}/search?${params}`, {
    timeout: 30_000,
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    console.error(`[nominatim] HTTP ${res.status} for location lookup`);
    return [];
  }

  try {
    const data = JSON.parse(res.body);
    return Array.isArray(data) ? data : [];
  } catch {
    console.error("[nominatim] JSON parse failed for location lookup");
    return [];
  }
}

export function chooseTownResult(results) {
  if (!Array.isArray(results)) return null;
  const usable = results.filter((place) => parseBoundingBox(place.boundingbox));
  return usable.find((place) => place.osm_type === "relation") || usable[0] || null;
}

export function buildOverpassQuery(location) {
  const selector = overpassAreaSelector(location);
  return `[out:json][timeout:45];
${selector.setup}
(
  nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|biergarten|ice_cream)$"]${selector.filter};
  nwr["shop"="ice_cream"]${selector.filter};
);
out center tags;`;
}

function overpassAreaSelector(location) {
  const osmId = Number(location.osm_id);
  if (location.osm_type === "relation" && Number.isSafeInteger(osmId) && osmId > 0) {
    const areaId = 3_600_000_000 + osmId;
    return { setup: `area(${areaId})->.searchArea;`, filter: "(area.searchArea)" };
  }

  const bounds = parseBoundingBox(location.boundingbox);
  if (!bounds) throw new Error("Location has no usable OpenStreetMap boundary");
  return { setup: "", filter: `(${bounds.join(",")})` };
}

export function formatElement(element) {
  const tags = element?.tags || {};
  const type = String(tags.amenity || tags.shop || "").toLowerCase();
  if (!VALID_TYPES.has(type)) return null;

  const name = tags.name || tags["name:it"] || "";
  if (name.trim().length < 2) return null;

  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const street = tags["addr:street"] || tags["addr:place"] || "";
  const housenumber = tags["addr:housenumber"] || "";
  const fullStreet = [street, housenumber].filter(Boolean).join(" ");
  const postcode = tags["addr:postcode"] || "";
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || "";
  const locality = [postcode, city].filter(Boolean).join(" ");
  const address = [fullStreet, locality].filter(Boolean).join(", ");

  return {
    name: normalizeName(name),
    type: type.replace("_", " "),
    address,
    latitude,
    longitude,
    coordinates_source: "osm",
    website: tags.website || tags["contact:website"] || undefined,
    phone: tags.phone || tags["contact:phone"] || undefined,
    cuisine: tags.cuisine || undefined,
    // Retain the established key so existing saved results and UI consumers
    // remain compatible. It is displayed to users as "OpenStreetMap".
    source: "nominatim",
    osm_id: `${element.type}/${element.id}`,
  };
}

function parseBoundingBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  const [south, north, west, east] = numbers;
  if (!numbers.every(Number.isFinite) || south >= north || west >= east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return [south, west, north, east];
}

function isPublicNominatim(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "nominatim.openstreetmap.org";
  } catch {
    return false;
  }
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function normalizeName(name) {
  return name
    .replace(/^ristorante\s+/i, "")
    .replace(/^trattoria\s+/i, "")
    .replace(/^pizzeria\s+/i, "")
    .replace(/^bar\s+/i, "")
    .trim();
}
