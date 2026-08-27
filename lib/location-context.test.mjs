import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocationContext, normalizeLocationContext, resolveMunicipalityMetadata,
} from "./location-context.mjs";

test("builds a LocationContext from one resolved municipality", () => {
  assert.deepEqual(createLocationContext({ municipality: "Oderzo", province_code: "TV" }, {
    osm_type: "relation", osm_id: 44648, lat: "45.779", lon: "12.494",
    boundingbox: ["45.74", "45.82", "12.43", "12.56"],
    address: { postcode: "31046", state: "Veneto", country_code: "it", county: "Treviso" },
  }), {
    municipality: "Oderzo", province_code: "TV", province: "Treviso", region: "Veneto",
    country_code: "IT", postcodes: ["31046"],
    centroid: { latitude: 45.779, longitude: 12.494 },
    bbox: [12.43, 45.74, 12.56, 45.82], osm_relation_id: "44648",
  });
});

test("legacy normalization retains a complete multiword municipality", () => {
  assert.equal(normalizeLocationContext("Motta di Livenza TV").municipality, "Motta di Livenza");
  assert.equal(normalizeLocationContext("Motta di Livenza", "TV").municipality, "Motta di Livenza");
});

test("checked-in metadata disambiguates same-name municipalities by province", () => {
  const catalog = { provinces: [["GE", "Genova"], ["MI", "Milano"]],
    towns: [["San Colombano", "GE"], ["San Colombano", "MI"]] };
  assert.deepEqual(resolveMunicipalityMetadata({ municipality: "San Colombano", province_code: "MI" }, catalog),
    { municipality: "San Colombano", province_code: "MI", province: "Milano" });
  assert.throws(() => resolveMunicipalityMetadata({ municipality: "San Colombano" }, catalog), /ambiguous/);
  assert.throws(() => resolveMunicipalityMetadata({ municipality: "San Colombano", province_code: "TV" }, catalog),
    /not in province/);
});
