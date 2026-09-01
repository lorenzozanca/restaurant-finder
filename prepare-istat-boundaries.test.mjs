import assert from "node:assert/strict";
import test from "node:test";
import { applyAdministrativeChanges } from "./prepare-istat-boundaries.mjs";
import { pointInGeometry } from "./lib/municipality-boundaries.mjs";

test("administrative merger retains both predecessor polygons under the current ISTAT identity", () => {
  const feature = (id, name, minX, maxX) => ({ type: "Feature", id,
    properties: { istat_code: id, municipality: name, province_code: "VI", region_code: "05" },
    geometry: { type: "Polygon", coordinates: [
      [[minX, 0], [maxX, 0], [maxX, 1], [minX, 1], [minX, 0]],
    ] } });
  const result = applyAdministrativeChanges([
    feature("024027", "Castegnero", 0, 1), feature("024071", "Nanto", 1, 2),
    feature("024001", "Other", 3, 4),
  ], [{ type: "municipality_merger", effective_date: "2026-02-21",
    predecessor_codes: ["024027", "024071"],
    successor: { istat_code: "024129", municipality: "Castegnero Nanto" },
    source_url: "https://www.istat.it/" }]);
  assert.deepEqual(result.features.map((item) => item.id), ["024001", "024129"]);
  const merged = result.features[1];
  assert.equal(merged.geometry.type, "MultiPolygon");
  assert.equal(pointInGeometry([0.5, 0.5], merged.geometry), "inside");
  assert.equal(pointInGeometry([1.5, 0.5], merged.geometry), "inside");
  assert.equal(pointInGeometry([1, 0.5], merged.geometry), "inside");
  assert.deepEqual(result.appliedChanges[0].predecessor_codes, ["024027", "024071"]);
});
