import test from "node:test";
import assert from "node:assert/strict";
import { importOverturePlaces, mapOverturePlace } from "./overture-places.mjs";

const fixture = "benchmark/v2/overture-places-oderzo.geojson";

test("imports an Overture bbox extract with stable IDs and local provenance", async () => {
  const result = await importOverturePlaces(fixture, {
    municipality: "Oderzo", province_code: "TV", country_code: "IT", postcodes: ["31046"],
  });
  assert.deepEqual(result.items.map((item) => item.name), ["Barhacca", "Ragazzon"]);
  assert.deepEqual(result.report.dropped_by_reason,
    { address_contradiction: 1, non_food_category: 1, outside_bbox: 1 });
  const barhacca = result.items[0];
  assert.equal(barhacca.overture_id, "fixture-overture-barhacca");
  assert.equal(barhacca.postcode, "31046");
  assert.equal(barhacca.address_components.locality, "Oderzo");
  assert.ok(barhacca.provenance.local_evidence[0].origin.includes("geometry_inside_bbox"));
});

test("rejects a place outside the local bbox before category admission", () => {
  const result = mapOverturePlace({ type: "Feature", geometry: { type: "Point", coordinates: [13, 46] },
    properties: { id: "outside", names: { primary: "Outside" }, categories: { primary: "restaurant" } } },
  { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT", bbox: [12.4, 45.7, 12.6, 45.9] });
  assert.equal(result.reason, "outside_bbox");
});

test("does not admit a non-food primary category from a noisy food alternate", () => {
  const result = mapOverturePlace({ type: "Feature", geometry: { type: "Point", coordinates: [12.49, 45.78] },
    properties: { id: "parking", names: { primary: "Parking" },
      categories: { primary: "parking", alternate: ["bar"] },
      addresses: [{ freeform: "Via Roma, 1", locality: "Oderzo", postcode: "31046", country: "IT" }] } },
  { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT", bbox: [12.4, 45.7, 12.6, 45.9] });
  assert.equal(result.reason, "non_food_category");
});

test("reads the current Overture freeform address and country fields", () => {
  const result = mapOverturePlace({ type: "Feature", geometry: { type: "Point", coordinates: [12.49, 45.78] },
    properties: { id: "restaurant", names: { primary: "Restaurant" },
      categories: { primary: "restaurant" }, addresses: [{ freeform: "Via Roma, 1",
        locality: "Oderzo", postcode: "31046", country: "IT" }] } },
  { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT", bbox: [12.4, 45.7, 12.6, 45.9] });
  assert.equal(result.item.address_components.street, "Via Roma, 1");
  assert.equal(result.item.address_components.country_code, "IT");
});

test("rejects a low-confidence place before publication", () => {
  const result = mapOverturePlace({ type: "Feature", geometry: { type: "Point", coordinates: [12.49, 45.78] },
    properties: { id: "weak", confidence: 0.5, names: { primary: "Weak Restaurant" },
      categories: { primary: "restaurant" }, addresses: [{ locality: "Oderzo", postcode: "31046" }] } },
  { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT", bbox: [12.4, 45.7, 12.6, 45.9] });
  assert.equal(result.reason, "low_confidence");
});

test("adds a municipality-free alias for identity matching", () => {
  const result = mapOverturePlace({ type: "Feature", geometry: { type: "Point", coordinates: [12.49, 45.78] },
    properties: { id: "local", confidence: 0.95, names: { primary: "Al Giardinetto Oderzo" },
      categories: { primary: "restaurant" }, addresses: [{ locality: "Oderzo", postcode: "31046" }] } },
  { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT", bbox: [12.4, 45.7, 12.6, 45.9] });
  assert.deepEqual(result.item.aliases, ["Al Giardinetto"]);
});

test("adds safe venue-type and Roman-V aliases for identity matching", () => {
  const location = { municipality: "Oderzo", postcodes: ["31046"], country_code: "IT",
    bbox: [12.4, 45.7, 12.6, 45.9] };
  const feature = (name, id) => ({ type: "Feature", geometry: { type: "Point", coordinates: [12.49, 45.78] },
    properties: { id, confidence: 0.95, names: { primary: name }, categories: { primary: "restaurant" },
      addresses: [{ locality: "Oderzo", postcode: "31046" }] } });
  assert.ok(mapOverturePlace(feature("Bar La Rotonda", "rotonda"), location).item.aliases.includes("La Rotonda"));
  assert.ok(mapOverturePlace(feature("Gatto Nero Pub", "gatto"), location).item.aliases.includes("Gatto Nero"));
  assert.ok(mapOverturePlace(feature("Gellivs Oderzo", "gellius"), location).item.aliases.includes("Gellius"));
  assert.ok(mapOverturePlace(feature("Ma'Ma' Ristorante Pizzeria", "mama"), location).item.aliases.includes("Ma'Ma'"));
  assert.ok(mapOverturePlace(feature("Ma'Ma' Ristorante Pizzeria", "mama"), location).item.aliases.includes("MaMa"));
  assert.ok(mapOverturePlace(feature("Pizzeria Ai Quattro Cantoni", "cantoni"), location).item.aliases.includes("Pizzeria Ai 4 Cantoni"));
  assert.ok(mapOverturePlace(feature("Pizzeria Ai Quattro Cantoni", "cantoni"), location).item.aliases.includes("Ai 4 Cantoni"));
});

test("fails closed when the extract location does not match the request", async () => {
  await assert.rejects(() => importOverturePlaces(fixture, { municipality: "Treviso" }),
    /does not match/);
});
