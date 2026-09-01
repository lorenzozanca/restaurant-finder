#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import proj4 from "proj4";
import * as shapefile from "shapefile";

const ISTAT_SOURCE_URL = "https://www.istat.it/storage/cartografia/confini_amministrativi/non_generalizzati/2026/Limiti01012026.zip";
const FROM_CRS = "EPSG:32632";
const TO_CRS = "EPSG:4326";
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function prepareIstatBoundaries(options = {}) {
  const sourceDirectory = resolve(required(options.sourceDirectory, "sourceDirectory"));
  const outputPath = resolve(required(options.outputPath, "outputPath"));
  const archivePath = options.archivePath ? resolve(options.archivePath) : null;
  const archiveSha256 = archivePath ? await sha256File(archivePath) : String(options.archiveSha256 || "");
  if (options.expectedArchiveSha256 && archiveSha256 !== options.expectedArchiveSha256) {
    throw new Error(`ISTAT archive checksum mismatch: expected ${options.expectedArchiveSha256}, received ${archiveSha256}`);
  }
  const requestedRegionCode = normalizeRegionCode(options.regionCode ?? 5);
  const includesRegion = (properties) => requestedRegionCode === null
    || Number(properties.COD_REG) === requestedRegionCode;
  const provinceRows = await readLayer(join(sourceDirectory,
    "ProvCM01012026/ProvCM01012026_WGS84"), includesRegion);
  const regionRows = await readLayer(join(sourceDirectory,
    "Reg01012026/Reg01012026_WGS84"), includesRegion);
  const provinces = new Map(provinceRows.map((feature) => [Number(feature.properties.COD_UTS), {
    province: feature.properties.DEN_UTS,
    province_code: feature.properties.SIGLA,
  }]));
  const regions = new Map(regionRows.map((feature) => [Number(feature.properties.COD_REG),
    feature.properties.DEN_REG]));
  if (regions.size === 0 || provinces.size === 0) {
    throw new Error(requestedRegionCode === null
      ? "ISTAT national metadata is missing"
      : `ISTAT region ${requestedRegionCode} metadata is missing`);
  }
  const municipalityRows = await readLayer(join(sourceDirectory,
    "Com01012026/Com01012026_WGS84"), includesRegion);
  let features = municipalityRows.map((feature) => {
    const regionCode = Number(feature.properties.COD_REG);
    const province = provinces.get(Number(feature.properties.COD_UTS));
    const region = regions.get(regionCode);
    if (!province) throw new Error(`province metadata missing for municipality ${feature.properties.PRO_COM_T}`);
    if (!region) throw new Error(`region metadata missing for municipality ${feature.properties.PRO_COM_T}`);
    return {
      type: "Feature",
      id: String(feature.properties.PRO_COM_T),
      properties: {
        istat_code: String(feature.properties.PRO_COM_T),
        municipality: feature.properties.COMUNE,
        alternate_name: feature.properties.COMUNE_A || null,
        province_code: province.province_code,
        province: province.province,
        region_code: String(regionCode).padStart(2, "0"),
        region,
      },
      geometry: transformGeometry(feature.geometry),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  let administrativeReferenceDate = "2026-01-01";
  let appliedChanges = [];
  if (options.changesPath) {
    const changes = JSON.parse(await readFile(resolve(options.changesPath), "utf8"));
    ({ features, appliedChanges } = applyAdministrativeChanges(features, changes.changes || []));
    administrativeReferenceDate = changes.reference_date || administrativeReferenceDate;
  }
  const document = {
    type: "FeatureCollection",
    metadata: {
      schema_version: 1,
      source: "ISTAT administrative boundaries for statistical purposes",
      source_url: ISTAT_SOURCE_URL,
      archive_sha256: archiveSha256 || undefined,
      reference_date: "2026-01-01",
      administrative_reference_date: administrativeReferenceDate,
      applied_administrative_changes: appliedChanges,
      detail: "non_generalized",
      original_crs: FROM_CRS,
      crs: TO_CRS,
      scope: requestedRegionCode === null ? "national" : "regional",
      country_code: "IT",
      ...(requestedRegionCode === null ? {
        region_codes: [...regions.keys()].sort((left, right) => left - right)
          .map((code) => String(code).padStart(2, "0")),
        regions: [...regions.entries()].sort(([left], [right]) => left - right)
          .map(([code, name]) => ({ code: String(code).padStart(2, "0"), name })),
      } : {
        region_code: String(requestedRegionCode).padStart(2, "0"),
        region: regions.get(requestedRegionCode),
      }),
      attribution: "Istituto nazionale di statistica (Istat)",
    },
    features,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  const serialized = `${JSON.stringify(document)}\n`;
  await writeFile(outputPath, serialized, "utf8");
  return { output_path: outputPath, features: features.length,
    sha256: createHash("sha256").update(serialized).digest("hex"), metadata: document.metadata };
}

export function applyAdministrativeChanges(features, changes) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const appliedChanges = [];
  for (const change of changes) {
    if (change.type !== "municipality_merger" || !Array.isArray(change.predecessor_codes)
        || !change.successor?.istat_code || !change.successor?.municipality) {
      throw new Error("unsupported ISTAT administrative change");
    }
    const predecessors = change.predecessor_codes.map((code) => byId.get(String(code)));
    if (predecessors.some((feature) => !feature)) {
      throw new Error(`administrative-change predecessor missing for ${change.successor.istat_code}`);
    }
    const first = predecessors[0];
    const polygons = predecessors.flatMap((feature) => feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates] : feature.geometry.coordinates);
    const successor = {
      type: "Feature", id: String(change.successor.istat_code),
      properties: { ...first.properties, istat_code: String(change.successor.istat_code),
        municipality: change.successor.municipality, alternate_name: null },
      geometry: { type: "MultiPolygon", coordinates: polygons },
    };
    for (const code of change.predecessor_codes) byId.delete(String(code));
    byId.set(successor.id, successor);
    appliedChanges.push({ type: change.type, effective_date: change.effective_date,
      predecessor_codes: change.predecessor_codes.map(String), successor: change.successor,
      source_url: change.source_url });
  }
  return { features: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    appliedChanges };
}

async function readLayer(basePath, predicate) {
  const source = await shapefile.open(`${basePath}.shp`, `${basePath}.dbf`, { encoding: "utf-8" });
  const features = [];
  while (true) {
    const row = await source.read();
    if (row.done) break;
    if (predicate(row.value.properties)) features.push(row.value);
  }
  return features;
}

function transformGeometry(geometry) {
  return { ...geometry, coordinates: transformCoordinates(geometry.coordinates) };
}
function transformCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) {
    const [longitude, latitude] = proj4(FROM_CRS, TO_CRS, value.slice(0, 2));
    return [round(longitude), round(latitude), ...value.slice(2)];
  }
  return value.map(transformCoordinates);
}
function round(value) { return Math.round(value * 1e9) / 1e9; }
async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function required(value, name) { if (!value) throw new TypeError(`--${name} is required`); return value; }
function normalizeRegionCode(value) {
  if (["all", "national", "italy", "*"].includes(String(value).trim().toLowerCase())) return null;
  const code = Number(value);
  if (!Number.isInteger(code) || code < 1 || code > 99) {
    throw new TypeError("regionCode must be an ISTAT region code or 'all'");
  }
  return code;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[key] = argv[++index];
  }
  return result;
}

if (isMain) {
  try { console.log(JSON.stringify(await prepareIstatBoundaries(parseArgs(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`prepare-istat-boundaries: ${error.message}`); process.exitCode = 1; }
}
