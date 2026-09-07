#!/usr/bin/env node
// Export venues with an actively attested official website as a GeoJSON
// FeatureCollection for the verified-venues map. Only durable accepted
// website facts gated by a live publisher attestation are exported;
// everything else stays in the backlog. Reads the evidence store, writes
// one file, makes no other change.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceStore } from "./lib/evidence-store.mjs";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function exportVerifiedMap(store, options = {}) {
  const at = options.at || new Date().toISOString();
  const rows = store.db.prepare(`SELECT v.venue_id, v.display_name, v.municipality,
      f.fact_key AS website, f.payload_json AS website_json
    FROM venues v
    JOIN facts f ON f.venue_id = v.venue_id
      AND f.kind = 'website' AND f.decision_status = 'accepted' AND f.lifecycle_status = 'active'
    WHERE v.lifecycle_status = 'active'
    ORDER BY v.display_name COLLATE NOCASE`).all();
  const features = [];
  let skippedNoCoordinates = 0;
  for (const row of rows) {
    if (!store.hasActivePublisherAttestation(row.venue_id, row.website, { at })) continue;
    const primary = store.db.prepare(`SELECT payload_json FROM source_records
      WHERE venue_id = ? ORDER BY source_record_id LIMIT 1`).get(row.venue_id);
    const record = primary ? JSON.parse(primary.payload_json) : {};
    const longitude = Number(record.longitude);
    const latitude = Number(record.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      skippedNoCoordinates++;
      continue;
    }
    const resources = store.db.prepare(`SELECT fact_key, payload_json FROM facts
      WHERE venue_id = ? AND kind = 'resource' AND decision_status = 'accepted'
        AND lifecycle_status = 'active'`).all(row.venue_id)
      .map((item) => ({ url: item.fact_key, ...JSON.parse(item.payload_json) }));
    const menus = resources.filter((item) => item.role === "menu");
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: {
        venue_id: row.venue_id,
        name: row.display_name,
        municipality: record.municipality || row.municipality,
        province: record.province_code || undefined,
        venue_type: record.type || undefined,
        address: record.address || undefined,
        website: row.website,
        resource_count: resources.length,
        menu_url: menus[0]?.url || resources[0]?.url || undefined,
      },
    });
  }
  return { features, skippedNoCoordinates, generatedAt: at };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`invalid argument ${item}`);
    const [rawKey, inline] = item.slice(2).split("=", 2);
    args[rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = inline ?? argv[++index];
  }
  return args;
}

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.db || !args.output) {
      throw new Error("usage: node export-verified-map.mjs --db PATH --output PATH.geojson");
    }
    const store = new EvidenceStore(resolve(String(args.db)));
    try {
      const { features, skippedNoCoordinates, generatedAt } = exportVerifiedMap(store);
      const document = { type: "FeatureCollection", generated_at: generatedAt,
        venue_count: features.length, skipped_no_coordinates: skippedNoCoordinates, features };
      const output = resolve(String(args.output));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(document)}\n`, "utf8");
      console.log(JSON.stringify({ output, venues: features.length, skipped_no_coordinates: skippedNoCoordinates }));
    } finally {
      store.close();
    }
  } catch (error) {
    console.error(`export-verified-map: ${error.message}`);
    process.exitCode = 1;
  }
}
