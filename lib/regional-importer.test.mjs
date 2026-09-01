import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EnrichmentQueue } from "./enrichment-queue.mjs";
import { importRegionalOverture, readGeoJsonSequence } from "./regional-importer.mjs";

const placesPath = "benchmark/v2/veneto-places-fixture.geojsonseq";
const boundariesPath = "benchmark/v2/veneto-boundaries-fixture.geojson";

test("regional import clips, assigns ISTAT municipalities, canonicalizes, and queues offline", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "restaurant-regional-import-"));
  const storePath = join(directory, "regional.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await importRegionalOverture({ placesPath, boundariesPath, regionCode: "05",
    overtureRelease: "fixture", storePath, runId: "fixture-import" });

  assert.equal(result.inventory.input_records, 6);
  assert.equal(result.inventory.accepted_source_records, 3);
  assert.equal(result.inventory.canonical_venues, 2);
  assert.equal(result.inventory.duplicate_source_records, 1);
  assert.equal(result.inventory.municipalities_with_venues, 2);
  assert.deepEqual(result.inventory.dropped_by_reason,
    { low_confidence: 1, non_food_category: 1, outside_region_bbox: 1 });
  const oderzo = result.venues.find((venue) => venue.municipality === "Oderzo");
  assert.equal(oderzo.istat_municipality_code, "026051");
  assert.equal(oderzo.source_records.length, 2);
  assert.ok(oderzo.provenance.municipality[0].boundary_sha256);
  const treviso = result.venues.find((venue) => venue.municipality === "Treviso");
  assert.equal(treviso.address_components.locality, "Centro storico");
  assert.ok(treviso.provenance.local_evidence[0].origin
    .includes("source_locality_differs_from_spatial_assignment"));

  const queue = new EnrichmentQueue(storePath);
  t.after(() => queue.close());
  assert.equal(queue.status().counts.queued, 2);
  assert.equal(queue.db.prepare("SELECT COUNT(*) AS count FROM venues").get().count, 2);
  assert.equal(queue.getRun("fixture-import").status, "completed");
  const repeated = await importRegionalOverture({ placesPath, boundariesPath, regionCode: "05",
    overtureRelease: "fixture", storePath, runId: "fixture-import" });
  assert.equal(repeated.manifest.queue.status.counts.queued, 2);
  const reopened = new EnrichmentQueue(storePath);
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs").get().count, 2);
  reopened.close();
});

test("regional import fingerprints are deterministic and checksums fail closed", async () => {
  const first = await importRegionalOverture({ placesPath, boundariesPath, regionCode: "05" });
  const second = await importRegionalOverture({ placesPath, boundariesPath, regionCode: "05" });
  assert.equal(first.manifest.inventory_fingerprint, second.manifest.inventory_fingerprint);
  await assert.rejects(() => importRegionalOverture({ placesPath, boundariesPath, regionCode: "05",
    expectedPlacesSha256: "0".repeat(64) }), /checksum mismatch/);
});

test("national import uses every boundary region and reports regional inventory", async () => {
  const result = await importRegionalOverture({ placesPath, boundariesPath,
    overtureRelease: "fixture" });
  assert.equal(result.manifest.scope, "national");
  assert.equal(result.manifest.region_code, null);
  assert.equal(result.inventory.canonical_venues, 2);
  assert.ok(result.venues.every((venue) => venue.canonical_venue_id.startsWith("venue:026")));
  assert.deepEqual(result.inventory.by_region, [{
    region_code: "05", region: "Veneto", boundary_municipalities: 2,
    municipalities_with_venues: 2,
    source_records: 3, canonical_venues: 2, duplicates: 1, websites: 1,
  }]);
  assert.equal(result.inventory.dropped_by_reason.outside_country_bbox, 1);
});

test("GeoJSONSeq reader preserves Unicode line separators inside JSON strings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "restaurant-geojsonseq-"));
  const path = join(directory, "unicode.geojsonseq");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const records = [{ id: "one", url: `https://example.test/a${String.fromCodePoint(0x2028)}b` },
    { id: "two" }];
  await writeFile(path, `${records.map(JSON.stringify).join("\n")}\n`, "utf8");
  const loaded = [];
  for await (const record of readGeoJsonSequence(path)) loaded.push(record);
  assert.deepEqual(loaded, records);
});
