import test from "node:test";
import assert from "node:assert/strict";
import { pilotDocument, selectPilot } from "./pilot-selector.mjs";

const catalog = [
  { istat_code: "001001", region_code: "01", tourism_stratum: "general_market",
    language_variant: false, force_known_name: "Chain" },
  { istat_code: "002002", region_code: "02", tourism_stratum: "tourism_focus",
    language_variant: true, force_known_name: null },
];
const inventory = [
  { istat_code: "001001", region_code: "01", region: "One", municipality: "Alpha", canonical_venues: 10 },
  { istat_code: "002002", region_code: "02", region: "Two", municipality: "Beta", canonical_venues: 200 },
];
const candidates = [
  candidate("a-known", "001001", "Chain", "fast food", "https://chain.test"),
  candidate("a-other", "001001", "Other", "restaurant", "https://other.test"),
  candidate("a-missing", "001001", "Cafe", "cafe", null),
  candidate("b-known", "002002", "Pizza", "pizzeria", "https://pizza.test"),
  candidate("b-missing", "002002", "Bar", "bar", null),
];

test("selects deterministic known/missing pairs across regions with blank labels", () => {
  const first = selectPilot(candidates, inventory, { municipalities: catalog, seed: "fixed" });
  const second = selectPilot([...candidates].reverse(), inventory, { municipalities: catalog, seed: "fixed" });
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.deepEqual(new Set(first.map((item) => item.region_code)), new Set(["01", "02"]));
  assert.equal(first.find((item) => item.venue_id === "a-known").chain_stratum, "known_chain");
  assert.deepEqual(first.map((item) => item.website_coverage_stratum), ["known", "missing", "known", "missing"]);
  assert.ok(first.every((item) => item.review.venue_status === null));
});

test("pins quota reserve and refuses to authorize a live run", () => {
  const selected = selectPilot(candidates, inventory, { municipalities: catalog, seed: "fixed" });
  const document = pilotDocument(selected);
  assert.equal(document.run_limits.reported_brave_allowance, 97);
  assert.equal(document.run_limits.brave_request_ceiling_across_cold_and_warm, 72);
  assert.equal(document.run_limits.retained_operational_reserve, 25);
  assert.equal(document.authorization.live_pilot, false);
  assert.equal(document.live_requests_made, 0);
});

test("fails closed when a website-coverage cell has no untouched candidate", () => {
  assert.throws(() => selectPilot(candidates.filter((item) => item.venue_id !== "b-missing"), inventory,
    { municipalities: catalog }), /no untouched queued candidate with missing website/);
});

function candidate(venueId, code, name, type, website) {
  return { job_id: venueId, venue_id: venueId, istat_municipality_code: code, name, type,
    known_website: website, address: null, latitude: 1, longitude: 2,
    source_record_id: `source:${venueId}`, source_record_count: 1 };
}
