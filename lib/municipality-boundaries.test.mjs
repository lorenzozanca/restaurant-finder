import assert from "node:assert/strict";
import test from "node:test";
import { assignMunicipality, createMunicipalityIndex, pointInGeometry } from "./municipality-boundaries.mjs";

test("assigns polygons and multipolygon islands while excluding holes", () => {
  const geometry = { type: "Polygon", coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
  ] };
  assert.equal(pointInGeometry([3, 3], geometry), "inside");
  assert.equal(pointInGeometry([1.5, 1.5], geometry), "outside");
  assert.equal(pointInGeometry([4, 2], geometry), "boundary");
  assert.equal(pointInGeometry([6, 2], geometry), "outside");
  assert.equal(pointInGeometry([11, 11], { type: "MultiPolygon", coordinates: [
    geometry.coordinates, [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
  ] }), "inside");
  assert.equal(pointInGeometry([1, 0.5], { type: "MultiPolygon", coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]],
  ] }), "inside", "a dissolved municipality's former internal border is inside");
});

test("assigns one municipality and quarantines shared-boundary points", () => {
  const municipality = (istat, minX, maxX) => ({ istat_code: istat, municipality: istat,
    province_code: "TV", region_code: "05", bbox: [minX, 0, maxX, 2],
    geometry: { type: "Polygon", coordinates: [
      [[minX, 0], [maxX, 0], [maxX, 2], [minX, 2], [minX, 0]],
    ] } });
  const boundaries = [municipality("026001", 0, 1), municipality("026002", 1, 2)];
  assert.equal(assignMunicipality(0.5, 1, boundaries).municipality.istat_code, "026001");
  assert.equal(assignMunicipality(3, 1, boundaries).status, "outside_region");
  assert.deepEqual(assignMunicipality(1, 1, boundaries), { status: "boundary_ambiguous",
    candidates: [
      { istat_code: "026001", municipality: "026001", province_code: "TV", region_code: "05" },
      { istat_code: "026002", municipality: "026002", province_code: "TV", region_code: "05" },
    ] });
  assert.equal(assignMunicipality(1.5, 1, createMunicipalityIndex(boundaries)).municipality.istat_code,
    "026002");
});
