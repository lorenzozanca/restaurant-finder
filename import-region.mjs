#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importRegionalOverture } from "./lib/regional-importer.mjs";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runRegionalImport(args) {
  const overtureManifestPath = resolve(required(args.overtureManifest, "overture-manifest"));
  const boundaryManifestPath = resolve(required(args.boundaryManifest, "boundary-manifest"));
  const reportPath = resolve(required(args.report, "report"));
  const overture = JSON.parse(await readFile(overtureManifestPath, "utf8"));
  const boundaries = JSON.parse(await readFile(boundaryManifestPath, "utf8"));
  const regionCode = boundaries.scope === "national" ? undefined
    : boundaries.region?.code || boundaries.region_code;
  const placesPath = resolve(dirname(overtureManifestPath), overture.file);
  const boundariesPath = resolve(dirname(boundaryManifestPath), boundaries.derived.file);
  let lastProgress = 0;
  const result = await importRegionalOverture({
    placesPath, boundariesPath,
    expectedPlacesSha256: overture.sha256,
    expectedBoundariesSha256: boundaries.derived.sha256,
    overtureRelease: overture.release,
    regionCode,
    storePath: args.store ? resolve(args.store) : undefined,
    runId: args.runId || `${regionCode ? `regional-${regionCode}` : "national"}-import:${overture.release}:${boundaries.reference_date}`,
    codeVersion: args.codeVersion || "working-tree",
    enqueue: args.enqueue !== "false",
    includeVenues: false,
    onProgress(progress) {
      if (progress.input_records - lastProgress >= 25_000) {
        lastProgress = progress.input_records;
        console.error(`processed ${progress.input_records} records; accepted ${progress.accepted_records}`);
      }
    },
  });
  result.manifest.overture.path = relative(process.cwd(), placesPath);
  result.manifest.boundaries.path = relative(process.cwd(), boundariesPath);
  if (result.manifest.queue?.store_path) {
    result.manifest.queue.store_path = relative(process.cwd(), result.manifest.queue.store_path);
  }
  const report = { schema_version: 1, generated_at: new Date().toISOString(),
    manifest: result.manifest, inventory: result.inventory };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report: reportPath, ...result.manifest, inventory_summary: {
    input_records: result.inventory.input_records,
    accepted_source_records: result.inventory.accepted_source_records,
    canonical_venues: result.inventory.canonical_venues,
    duplicate_source_records: result.inventory.duplicate_source_records,
    municipalities_with_venues: result.inventory.municipalities_with_venues,
    websites: result.inventory.websites,
    website_coverage: result.inventory.website_coverage,
    dropped_records: result.inventory.dropped_records,
  } };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--help" || item === "-h") { result.help = true; continue; }
    if (!item.startsWith("--")) continue;
    const [rawKey, inline] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[key] = inline ?? argv[++index];
  }
  return result;
}
function required(value, name) { if (!value) throw new TypeError(`--${name} is required`); return value; }
function usage() {
  return `Usage: node import-region.mjs \\
  --overture-manifest PATH --boundary-manifest PATH --report PATH [--store PATH]\n\n` +
    `The import is offline. --store persists canonical venues and queues enrichment jobs.\n` +
    `Use --enqueue=false to populate only the venue store.`;
}

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log(usage());
  else {
    try { console.log(JSON.stringify(await runRegionalImport(args), null, 2)); }
    catch (error) { console.error(`import-region: ${error.message}`); process.exitCode = 1; }
  }
}
