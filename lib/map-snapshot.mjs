import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { loadNationalVenueIndex } from "./national-map.mjs";

// The map snapshot is a compact, columnar copy of everything the national lead
// map shows, derived from the national store. Building it takes seconds (it reads
// every source record); loading it takes well under a second, so the map server
// never builds it on a request path. It is rebuilt after each publish and whenever
// the national store changes.

export const SNAPSHOT_FORMAT = 1;

// Lead status, in precedence order. `rejected` and `verified` come only from
// publisher attestations; the rest describe what the crawl found.
export const STATUSES = [
  { code: "verified", label: "Verified website" },
  { code: "rejected", label: "Rejected website" },
  { code: "directory", label: "Directory or social link" },
  { code: "unresolved", label: "Checked, undecided" },
  { code: "unreachable", label: "Site unreachable" },
  { code: "unchecked", label: "Not checked yet" },
  { code: "no_website", label: "No website" },
];

export const CATEGORIES = [
  { code: "restaurant", label: "Restaurant", types: ["restaurant"] },
  { code: "pizzeria", label: "Pizzeria", types: ["pizzeria"] },
  { code: "bar", label: "Bar", types: ["bar"] },
  { code: "cafe", label: "Café", types: ["cafe"] },
  { code: "pub", label: "Pub", types: ["pub"] },
  { code: "fast_food", label: "Fast food", types: ["fast food"] },
  { code: "ice_cream", label: "Gelateria", types: ["ice cream"] },
  { code: "other", label: "Other", types: [] },
];

export const REGIONS = {
  "01": "Piemonte", "02": "Valle d'Aosta", "03": "Lombardia", "04": "Trentino-Alto Adige",
  "05": "Veneto", "06": "Friuli-Venezia Giulia", "07": "Liguria", "08": "Emilia-Romagna",
  "09": "Toscana", "10": "Umbria", "11": "Marche", "12": "Lazio", "13": "Abruzzo",
  "14": "Molise", "15": "Campania", "16": "Puglia", "17": "Basilicata", "18": "Calabria",
  "19": "Sicilia", "20": "Sardegna",
};

const STATUS_INDEX = new Map(STATUSES.map((status, index) => [status.code, index]));
const CATEGORY_BY_TYPE = new Map(CATEGORIES.flatMap((category, index) =>
  category.types.map((type) => [type, index])));
const OTHER_CATEGORY = CATEGORIES.length - 1;

export function snapshotPathFor(databasePath) {
  return databasePath.replace(/\.sqlite$/, "") + ".map-snapshot.json";
}

// Modification stamp of the store (database plus WAL); a snapshot older than this
// is stale.
export function storeStamp(databasePath) {
  let stamp = 0;
  for (const path of [databasePath, `${databasePath}-wal`]) {
    if (existsSync(path)) stamp = Math.max(stamp, statSync(path).mtimeMs);
  }
  return stamp;
}

export function leadStatus(venue) {
  if (venue.status === "verified") return "verified";
  if (venue.status === "rejected") return "rejected";
  if (!venue.candidate_url) return "no_website";
  const state = venue.candidate_assessment?.state;
  if (!state) return "unchecked";
  if (state === "retryable") return "unreachable";
  if (state === "unsupported_publisher") return "directory";
  return "unresolved";
}

export function buildMapSnapshot(databasePath, options = {}) {
  const stamp = storeStamp(databasePath);
  const builtAt = String(options.at || new Date().toISOString());
  const index = loadNationalVenueIndex(databasePath, { at: builtAt });
  const columns = {
    id: [], name: [], municipality: [], province: [], region: [], category: [], status: [],
    lat: [], lon: [], address: [], phone: [], candidate_url: [], verified_url: [], menu_url: [],
    assessment: [], failure: [], checked_at: [],
  };
  for (const venue of index.venues) {
    const evidence = Array.isArray(venue.candidate_assessment?.evidence) ? venue.candidate_assessment.evidence : [];
    columns.id.push(venue.id);
    columns.name.push(venue.name || "");
    columns.municipality.push(venue.municipality || "");
    columns.province.push(venue.province || "");
    columns.region.push(venue.region || "");
    columns.category.push(CATEGORY_BY_TYPE.get(String(venue.type || "").toLowerCase()) ?? OTHER_CATEGORY);
    columns.status.push(STATUS_INDEX.get(leadStatus(venue)));
    columns.lat.push(Math.round(venue.latitude * 1e6) / 1e6);
    columns.lon.push(Math.round(venue.longitude * 1e6) / 1e6);
    columns.address.push(venue.address || "");
    columns.phone.push(venue.phone || "");
    columns.candidate_url.push(venue.candidate_url || "");
    columns.verified_url.push(venue.verified_url || "");
    columns.menu_url.push(venue.menu_url || "");
    columns.assessment.push(venue.candidate_assessment?.state || "");
    columns.failure.push(evidence.find((item) => typeof item === "string" && item.startsWith("failure_"))
      ?.slice("failure_".length) || "");
    columns.checked_at.push(venue.candidate_assessment?.checked_at || "");
  }
  const version = createHash("sha256").update(`${builtAt}\n${stamp}\n${columns.id.length}`)
    .digest("hex").slice(0, 12);
  return {
    format: SNAPSHOT_FORMAT, version, built_at: builtAt, store_stamp: stamp,
    count: columns.id.length, stats: index.stats, columns,
  };
}

export function writeMapSnapshot(databasePath, outputPath = snapshotPathFor(databasePath), options = {}) {
  const snapshot = buildMapSnapshot(databasePath, options);
  const temporary = `${outputPath}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, outputPath);
  return { path: outputPath, version: snapshot.version, count: snapshot.count };
}

export function readMapSnapshot(path) {
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  if (snapshot.format !== SNAPSHOT_FORMAT) throw new Error(`unsupported map snapshot format ${snapshot.format}`);
  return snapshot;
}
