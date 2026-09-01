import test from "node:test";
import assert from "node:assert/strict";
import { collectVenueIds, selectUnseenSample, unseenSelectionDocument } from "./unseen-selector.mjs";

const inventory = Array.from({ length: 20 }, (_, regionIndex) => {
  const region = String(regionIndex + 1).padStart(2, "0");
  return [10, 50, 200].map((count, sizeIndex) => ({ istat_code: `${region}${sizeIndex}`,
    region_code: region, region: `Region ${region}`, municipality: `Town ${region}-${sizeIndex}`,
    canonical_venues: count }));
}).flat();
const candidates = inventory.flatMap((municipality) => Array.from({ length: 16 }, (_, index) => ({
  venue_id: `venue:${municipality.istat_code}:${index}`,
  job_id: index,
  name: index === 1 ? "McDonald's" : `Venue ${index}`,
  type: ["restaurant", "cafe", "pizzeria", "bar"][index % 4],
  known_website: index % 2 === 0 ? `https://venue-${municipality.istat_code}-${index}.test` : null,
  istat_municipality_code: municipality.istat_code,
  address: null, latitude: 1, longitude: 2, source_record_id: `source:${index}`,
  source_record_count: 1,
})));

test("selects and freezes a deterministic 200/100 unseen split across all regions", () => {
  const first = selectUnseenSample(candidates, inventory, { seed: "fixed" });
  const second = selectUnseenSample([...candidates].reverse(), inventory, { seed: "fixed" });
  assert.deepEqual(first, second);
  assert.equal(first.length, 300);
  assert.equal(first.filter((row) => row.partition === "development").length, 200);
  assert.equal(first.filter((row) => row.partition === "locked_holdout").length, 100);
  assert.equal(new Set(first.map((row) => row.region_code)).size, 20);
  assert.ok(first.every((row) => row.region_sample_index <= 15));
  const document = unseenSelectionDocument(first);
  assert.equal(document.status, "frozen_before_search_outcomes");
  assert.equal(document.brave_requests_made, 0);
  assert.match(document.candidate_fingerprint_sha256, /^[a-f0-9]{64}$/);
});

test("recursively collects benchmark venue IDs and excludes them", () => {
  const excludedId = candidates[0].venue_id;
  const ids = collectVenueIds({ cases: [{ canonical_venue_id: excludedId }], ignored: "venue:no" });
  assert.deepEqual([...ids], [excludedId]);
  const selected = selectUnseenSample(candidates, inventory, { seed: "fixed", excludedVenueIds: ids });
  assert.ok(!selected.some((row) => row.venue_id === excludedId));
});
