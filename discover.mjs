#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discover as nominatim } from "./sources/nominatim.mjs";
import { discover as thefork } from "./sources/thefork.mjs";
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

console.log(`\n🏘️  Restaurant Finder — "${town}"${province ? ` (${province})` : ""}\n`);

console.log("[1/3] Discovering restaurants...\n");

const nominatimResults = await safeCall(nominatim, town, province);
await sleep(2000);
const theforkResults = await safeCall(thefork, town);
await sleep(2000);
const webSearchResults = await safeCall(webSearch, town);
await sleep(2000);
const paginegialleResults = await safeCall(paginegialle, town);

const allRaw = [
  ...nominatimResults,
  ...theforkResults,
  ...webSearchResults,
  ...paginegialleResults,
];

console.log(`  nominatim:    ${nominatimResults.length}`);
console.log(`  thefork:      ${theforkResults.length}`);
console.log(`  web search:   ${webSearchResults.length}`);
console.log(`  paginegialle: ${paginegialleResults.length}`);
console.log(`  total raw:    ${allRaw.length}\n`);

const merged = mergeAndDedupe(allRaw)
  .filter(isNotGarbage)
  .map(normalizeRecord);
console.log(`  after dedup & filter: ${merged.length} restaurants\n`);

console.log("[2/3] Hunting menus...\n");

const TOP_N = 20;
const toProcess = merged.slice(0, TOP_N);
const rest = merged.slice(TOP_N);

const enriched = [];
for (let i = 0; i < toProcess.length; i++) {
  const r = toProcess[i];
const locationStr = province ? `${town} ${province}` : town;
    process.stdout.write(`  [${i + 1}/${toProcess.length}] ${r.name} ... `);
    const menuSources = await findMenuSources(r, locationStr);
  const found = menuSources.length;
  if (found === 0) {
    process.stdout.write("no menu found\n");
  } else {
    process.stdout.write(`${found} source${found > 1 ? "s" : ""}\n`);
  }
  enriched.push({
    ...r,
    menu_sources: menuSources,
    no_menu_found: menuSources.length === 0,
  });
}

for (const r of rest) {
  enriched.push({
    ...r,
    menu_sources: [],
    no_menu_found: true,
  });
}

const output = {
  location: town,
  province: province || undefined,
  searched_at: today,
  sources_used: ["nominatim", "thefork", "web_search", "paginegialle"],
  total_found: enriched.length,
  with_menu: enriched.filter((r) => r.menu_sources.length > 0).length,
  restaurants: enriched,
};

console.log("\n[3/3] Writing output...");

const outDir = resolve(OUTPUT_DIR, town.toLowerCase());
await mkdir(outDir, { recursive: true });

const outPath = resolve(outDir, `${today}.json`);
await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");

console.log(`\n✅ Done. ${enriched.length} restaurants → ${outPath}`);
console.log(`   ${output.with_menu} with menus, ${enriched.length - output.with_menu} without\n`);

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      if (r.website && !existing.website) existing.website = r.website;
      if (r.phone && !existing.phone) existing.phone = r.phone;
      if (r.address && !existing.address) existing.address = r.address;
      if (r.cuisine && !existing.cuisine) existing.cuisine = r.cuisine;
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