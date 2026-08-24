#!/usr/bin/env node
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discover as nominatim,
  geocode,
  canBulkGeocode,
} from "./sources/nominatim.mjs";
import { discover as webSearch } from "./sources/web-search.mjs";
import { discover as paginegialle } from "./sources/paginegialle.mjs";
import { findMenuSources } from "./find-menu.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "output");

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
const ENRICHMENT_VERSION = 8;
const outputVariant = String(process.env.OUTPUT_VARIANT || "")
  .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

console.log(`\n🏘️  Restaurant Finder — "${town}"${province ? ` (${province})` : ""}\n`);

console.log("[1/3] Discovering restaurants...\n");

const [nominatimResults, webSearchResults, paginegialleResults] =
  await Promise.all([
    safeCall(nominatim, town, province),
    safeCall(webSearch, town),
    safeCall(paginegialle, town),
  ]);

const allRaw = [
  ...nominatimResults,
  ...webSearchResults,
  ...paginegialleResults,
];

console.log(`  nominatim:    ${nominatimResults.length}`);
console.log(`  web search:   ${webSearchResults.length}`);
console.log(`  paginegialle: ${paginegialleResults.length}`);
console.log(`  total raw:    ${allRaw.length}\n`);

const merged = mergeAndDedupe(allRaw)
  .filter(isNotGarbage)
  .map(normalizeRecord);
console.log(`  after dedup & filter: ${merged.length} restaurants\n`);

await addMissingCoordinates(merged, town, province);

console.log("[2/3] Gathering online resources...\n");

const TOP_N = 20;
// Spend the resource-hunting budget on the strongest candidates, rather than
// whichever names happen to come first alphabetically. Keep original indexes
// so the final result remains an alphabetical list.
const toProcess = merged
  .map((restaurant, index) => ({ restaurant, index }))
  .sort((a, b) => enrichmentPriority(b.restaurant) - enrichmentPriority(a.restaurant)
    || a.restaurant.name.localeCompare(b.restaurant.name, "it"))
  .slice(0, TOP_N);
const locationStr = province ? `${town} ${province}` : town;

const outDir = resolve(OUTPUT_DIR, town.toLowerCase());
const outPath = resolve(outDir, `${today}${outputVariant ? `.${outputVariant}` : ""}.json`);

let previousByName = new Map();
try {
  const previous = JSON.parse(await readFile(outPath, "utf-8"));
  if (previous.enrichment_version === ENRICHMENT_VERSION && Array.isArray(previous.restaurants)) {
    for (const r of previous.restaurants) {
      if (r.name && r.resources_checked) {
        previousByName.set(r.name.toLowerCase(), {
          website: r.website,
          website_kind: r.website_kind,
          website_confidence: r.website_confidence,
          directory_url: r.directory_url,
          resources: Array.isArray(r.resources) ? r.resources : [],
        });
      }
    }
  }
} catch {}

const WORKERS = 4;
const enriched = merged.map((r) => ({
  ...r,
  resources: [],
  resources_checked: false,
  no_resources_found: true,
}));
let nextIndex = 0;

async function worker() {
  while (true) {
    const i = nextIndex++;
    if (i >= toProcess.length) return;
    const { restaurant: r, index } = toProcess[i];

    const cachedOnline = previousByName.get((r.name || "").toLowerCase());
    const online = cachedOnline !== undefined
      ? cachedOnline
      : await findMenuSources(r, locationStr);

    enriched[index] = {
      ...r,
      website: online.website,
      website_kind: online.website_kind,
      website_confidence: online.website_confidence,
      directory_url: online.directory_url,
      resources: online.resources,
      resources_checked: true,
      no_resources_found: online.resources.length === 0 && !online.website,
    };
    process.stdout.write(resourcesLine(i, toProcess.length, r.name, online.resources.length));
  }
}

await Promise.all(
  Array.from({ length: Math.min(WORKERS, toProcess.length) }, () => worker())
);

const output = {
  location: town,
  province: province || undefined,
  searched_at: today,
  enrichment_version: ENRICHMENT_VERSION,
  sources_used: ["nominatim", "web_search", "paginegialle"],
  attribution: [
    {
      source: "OpenStreetMap",
      notice: "© OpenStreetMap contributors",
      license: "ODbL-1.0",
      url: "https://www.openstreetmap.org/copyright",
    },
  ],
  total_found: enriched.length,
  with_resources: enriched.filter((r) => r.resources.length > 0).length,
  with_official_website: enriched.filter((r) => r.website_kind === "official").length,
  restaurants: enriched,
};

console.log("\n[3/3] Writing output...");

await mkdir(outDir, { recursive: true });

await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");

console.log(`\n✅ Done. ${enriched.length} restaurants → ${outPath}`);
console.log(`   ${output.with_resources} with online resources, ${enriched.length - output.with_resources} without\n`);

function unwrap(result) {
  return result.status === "fulfilled" ? result.value : [];
}

async function safeCall(fn, ...args) {
  try {
    return await fn(...args);
  } catch (err) {
    console.error(`  ${fn.name || "source"} failed: ${err.message}`);
    return [];
  }
}

function resourcesLine(i, total, name, found) {
  const tail = found === 0
    ? "no resources found"
    : `${found} source${found > 1 ? "s" : ""}`;
  return `  [${i + 1}/${total}] ${name} ... ${tail}\n`;
}

async function addMissingCoordinates(restaurants, townName, provinceName) {
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
      coordinates = await geocode(r.address, townName, provinceName);
    } catch (err) {
      console.error(`  address geocoding failed for ${r.name}: ${err.message}`);
    }
    if (coordinates) {
      Object.assign(r, coordinates, { coordinates_source: "address" });
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

function normalizeKey(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\w\sà-ù]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  if (domainGarbage.some((d) => website.includes(d))) return false;

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
  let name = (r.name || "").trim()
    .replace(/^[^\wà-ù']+/i, "")
    .replace(/["«„]/g, "")
    .replace(/[»"]/g, "")
    .replace(/\s+/g, " ");
  name = capitalizeWords(name);
  return { ...r, name };
}

function capitalizeWords(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function mergeAndDedupe(restaurants) {
  const groups = new Map();

  for (const r of restaurants) {
    const key = normalizeKey(r.name);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, { ...r });
    } else {
      if (r.website && (!existing.website
          || websiteQuality(r.website) > websiteQuality(existing.website))) {
        existing.website = r.website;
      }
      if (r.phone && !existing.phone) existing.phone = r.phone;
      if (r.address && !existing.address) existing.address = r.address;
      if (r.cuisine && !existing.cuisine) existing.cuisine = r.cuisine;
      if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
          && (!Number.isFinite(existing.latitude) || !Number.isFinite(existing.longitude))) {
        existing.latitude = r.latitude;
        existing.longitude = r.longitude;
      }
      if (r.osm_id && !existing.osm_id) existing.osm_id = r.osm_id;
      if (r.type && existing.type === "restaurant" && r.type !== "restaurant") {
        existing.type = r.type;
      }
      const existingSources = new Set(
        (existing.sources || []).concat(r.source).filter(Boolean)
      );
      existing.sources = [...existingSources];
    }
  }

  return [...groups.values()]
    .map((r) => {
      const { source, ...rest } = r;
      return { ...rest, sources: r.sources || (source ? [source] : []) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

function websiteQuality(website) {
  const value = String(website || "").toLowerCase();
  if (!value) return 0;
  if (isDirectoryWebsite(value)) return 1;
  if (["outdooractive.com", "wheree.com", "paginebianche.it", "virgilio.it"]
    .some((domain) => value.includes(domain))) return 1;
  return 3;
}
