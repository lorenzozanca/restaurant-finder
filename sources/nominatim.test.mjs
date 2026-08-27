import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOverpassQuery,
  canBulkGeocode,
  chooseTownResult,
  formatElement,
  resolveLocationContext,
} from "./nominatim.mjs";

test("prefers a relation so Overpass can use the exact town boundary", () => {
  const node = { osm_type: "node", osm_id: 1, boundingbox: ["45", "46", "12", "13"] };
  const relation = { osm_type: "relation", osm_id: 123, boundingbox: ["45", "46", "12", "13"] };
  assert.equal(chooseTownResult([node, relation]), relation);
});

test("builds one POI query against the resolved relation area", () => {
  const query = buildOverpassQuery({
    osm_type: "relation",
    osm_id: 123,
    boundingbox: ["45", "46", "12", "13"],
  });
  assert.match(query, /area\(3600000123\)->\.searchArea/);
  assert.match(query, /restaurant\|cafe\|bar\|pub/);
  assert.doesNotMatch(query, /shop.*ice_cream/);
  assert.match(query, /out center tags/);
});

test("falls back to the town bounding box when Nominatim returns a node", () => {
  const query = buildOverpassQuery({
    osm_type: "node",
    osm_id: 123,
    boundingbox: ["45.1", "45.9", "12.2", "12.8"],
  });
  assert.match(query, /\(45\.1,12\.2,45\.9,12\.8\)/);
});

test("converts an Overpass venue with structured identity fields", () => {
  assert.deepEqual(formatElement({
    type: "way",
    id: 42,
    center: { lat: 45.78, lon: 12.49 },
    tags: {
      amenity: "restaurant",
      name: "Trattoria Al Ponte",
      "addr:street": "Via Roma",
      "addr:housenumber": "4",
      "addr:postcode": "31046",
      "addr:city": "Oderzo",
      "contact:website": "https://example.test",
      cuisine: "italian",
    },
  }), {
    name: "Al Ponte",
    type: "restaurant",
    address: "Via Roma 4, 31046 Oderzo",
    address_components: { street: "Via Roma", house_number: "4", locality: "Oderzo",
      postcode: "31046", country_code: "IT" },
    postcode: "31046",
    latitude: 45.78,
    longitude: 12.49,
    coordinates_source: "osm",
    website: "https://example.test",
    phone: undefined,
    cuisine: "italian",
    source: "nominatim",
    osm_id: "way/42",
    provider_place_id: "osm:way/42",
    provider_record_url: "https://www.openstreetmap.org/way/42",
  });
});

test("resolves a multiword municipality once and retains its complete identity", async () => {
  let query;
  const context = await resolveLocationContext("Motta di Livenza", "TV", {
    catalog: { provinces: [["TV", "Treviso"]], towns: [["Motta di Livenza", "TV"]] },
    queryFn: async (params) => {
      query = params.get("q");
      return [{ osm_type: "relation", osm_id: 1, lat: "45.77", lon: "12.61",
        boundingbox: ["45.7", "45.9", "12.5", "12.7"],
        address: { postcode: "31045", state: "Veneto", country_code: "it" } }];
    },
  });
  assert.equal(query, "Motta di Livenza, TV, Italy");
  assert.equal(context.municipality, "Motta di Livenza");
  assert.deepEqual(context.postcodes, ["31045"]);
});

test("public Nominatim is not used for automated address enrichment", () => {
  assert.equal(canBulkGeocode("https://nominatim.openstreetmap.org"), false);
  assert.equal(canBulkGeocode("https://maps.example.test/nominatim"), true);
});
