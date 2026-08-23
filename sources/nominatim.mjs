import { get } from "../../scripts/lib.mjs";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const UA = "restaurant-finder/0.1 (pomovi research; nominatim)";

const VALID_TYPES = [
  "restaurant", "cafe", "bar", "pub", "fast_food", "food_court",
  "biergarten", "ice_cream",
];

const VALID_CLASSES = ["amenity", "tourism", "leisure", "shop"];

export async function discover(town, province = "") {
  const loc = province ? `${town} ${province}` : town;
  const encoded = loc.replace(/\s+/g, "+");

  const typeQueries = ["restaurant", "bar", "pizzeria", "fast_food"];

  const all = [];
  const seenOsm = new Set();

  for (const tq of typeQueries) {
    const data = await queryNominatim(`${tq}+${encoded}`);
    for (const place of data) {
      const osmId = `${place.osm_type}/${place.osm_id}`;
      if (seenOsm.has(osmId)) continue;
      seenOsm.add(osmId);

      const result = formatPlace(place);
      if (result) all.push(result);
    }
  }

  for (const tq of typeQueries) {
    const data = await queryNominatim(`${tq}+near+${encoded}`);
    for (const place of data) {
      const osmId = `${place.osm_type}/${place.osm_id}`;
      if (seenOsm.has(osmId)) continue;
      seenOsm.add(osmId);

      const result = formatPlace(place);
      if (result) all.push(result);
    }
  }

  return all;
}

function formatPlace(place) {
  const cls = place.class || "";
  const type = (place.type || "").toLowerCase();
  if (!VALID_CLASSES.includes(cls)) return null;
  if (!VALID_TYPES.includes(type)) return null;

  const addr = place.address || {};
  const extratags = place.extratags || {};

  const name = place.name || place.display_name?.split(",")[0]?.trim() || "";
  if (!name || name.length < 2) return null;

  const street = addr.road || addr.pedestrian || "";
  const housenumber = addr.house_number || "";
  const fullStreet = housenumber ? `${street} ${housenumber}` : street;
  const postcode = addr.postcode || "";
  const city = addr.town || addr.city || addr.village || addr.municipality || "";
  const formattedAddress = fullStreet
    ? `${fullStreet}, ${postcode} ${city}`.trim()
    : place.display_name?.split(",").slice(0, 3).join(",").trim() || "";

  return {
    name: normalizeName(name),
    type: type.replace("_", " "),
    address: formattedAddress,
    website: extratags.website || extratags["contact:website"] || undefined,
    phone: extratags.phone || extratags["contact:phone"] || undefined,
    cuisine: extratags.cuisine || undefined,
    source: "nominatim",
    osm_id: `${place.osm_type}/${place.osm_id}`,
  };
}

async function queryNominatim(query) {
  const url = `${NOMINATIM}/search?q=${query}&format=json&limit=50&addressdetails=1&extratags=1&accept-language=it&countrycodes=it`;

  const res = await get(url, {
    timeout: 30_000,
    headers: { "User-Agent": UA },
  });

  if (!res.ok) {
    console.error(`[nominatim] HTTP ${res.status} for "${query}"`);
    return [];
  }

  try {
    const data = JSON.parse(res.body);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    console.error(`[nominatim] JSON parse failed for "${query}"`);
    return [];
  }
}

function normalizeName(name) {
  return name
    .replace(/^ristorante\s+/i, "")
    .replace(/^trattoria\s+/i, "")
    .replace(/^pizzeria\s+/i, "")
    .replace(/^bar\s+/i, "")
    .trim();
}