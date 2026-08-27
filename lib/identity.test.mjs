import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeVenues, compareVenueRecords, coreVenueName } from "./identity.mjs";

const osm = (overrides) => ({
  name: "Fixture Venue", type: "restaurant", source: "nominatim",
  latitude: 45.78, longitude: 12.49,
  provenance: { name: [{ source: "nominatim", origin: "osm_object" }] },
  ...overrides,
});

test("merges the Ca'Lozzio OSM node/way pair with auditable evidence", () => {
  const venues = canonicalizeVenues([
    osm({ name: "Ca' Lozzio", osm_id: "way/178807553", website: "http://www.calozzio.com" }),
    osm({ name: "Ca'Lozzio", osm_id: "node/2538162437", website: "https://www.calozzio.com/", latitude: 45.7801 }),
  ], { location: "Oderzo" });

  assert.equal(venues.length, 1);
  assert.deepEqual(venues[0].aliases, ["Ca' Lozzio", "Ca'Lozzio"]);
  assert.equal(venues[0].canonical_venue_id, "venue:oderzo:ca-lozzio");
  assert.equal(venues[0].source_records.length, 2);
  assert.equal(venues[0].merge_audit.length, 1);
  assert.ok(venues[0].merge_audit[0].evidence.some((item) => item.type === "distance"));
  assert.ok(venues[0].merge_audit[0].evidence.some((item) => item.type === "website_exact"));
});

test("connects restaurant-prefix and article aliases only with corroboration", () => {
  const records = [
    osm({ name: "Giardinetto", osm_id: "node/1", website: undefined,
      address: "Via Spinè 28, 31046 Oderzo", postcode: "31046",
      address_components: { street: "Via Spinè", house_number: "28", locality: "Oderzo", postcode: "31046" } }),
    { name: "Al Giardinetto", source: "overture_places", provider_place_id: "place-giardinetto",
      address: "Via Spine, 28, 31046 Oderzo", postcode: "31046",
      address_components: { street: "Via Spine", house_number: "28", locality: "Oderzo", postcode: "31046" } },
    osm({ name: "Dussin", osm_id: "node/2", website: "https://dussin.example/", latitude: 45.79 }),
    { name: "Ristorante Locanda Dussin", source: "web_search", website: "https://dussin.example/" },
  ];
  const venues = canonicalizeVenues(records, { location: "Oderzo" });

  assert.equal(venues.length, 2);
  assert.deepEqual(venues.find((v) => v.aliases.includes("Giardinetto")).aliases,
    ["Al Giardinetto", "Giardinetto"]);
  assert.ok(venues.find((v) => v.aliases.includes("Giardinetto")).merge_audit[0].evidence
    .some((item) => ["address_exact", "street_number_exact"].includes(item.type)));
  assert.ok(venues.find((v) => v.aliases.includes("Giardinetto")).merge_audit[0].evidence
    .some((item) => item.type === "independent_source_records"));
  assert.deepEqual(venues.find((v) => v.aliases.includes("Dussin")).aliases,
    ["Dussin", "Ristorante Locanda Dussin"]);
});

test("does not merge fuzzy or exact names without independent evidence", () => {
  const venues = canonicalizeVenues([
    osm({ name: "Bar Centrale", osm_id: "node/1", website: undefined, latitude: undefined, longitude: undefined }),
    { name: "Bar Centrale", source: "web_search" },
    { name: "Centrale", source: "paginegialle" },
  ], { location: "Parma" });
  assert.equal(venues.length, 3);
  assert.ok(venues.every((venue) => venue.identity_review?.length >= 1));
});

test("chain locations with conflicting coordinates remain separate", () => {
  const left = osm({ name: "Fixture Roma", website: "https://chain.example/locations/centro", latitude: 41.9, longitude: 12.49 });
  const right = osm({ name: "Fixture Roma", website: "https://chain.example/locations/eur", latitude: 41.82, longitude: 12.47 });
  const decision = compareVenueRecords(left, right);
  assert.equal(decision.merge, false);
  assert.ok(decision.conflicts.some((item) => item.type === "location_conflict"));
});

test("canonicalization is deterministic across input order", () => {
  const records = [
    osm({ name: "Ca' Lozzio", osm_id: "way/1", website: "http://calozzio.example" }),
    osm({ name: "Ca'Lozzio", osm_id: "node/2", website: "https://calozzio.example/", latitude: 45.7801 }),
  ];
  const forward = canonicalizeVenues(records, { location: "Oderzo" })[0];
  const reverse = canonicalizeVenues(records.toReversed(), { location: "Oderzo" })[0];
  assert.deepEqual(forward, reverse);
});

test("core names normalize common venue prefixes and legal suffixes", () => {
  assert.equal(coreVenueName("Ristorante Locanda Dussin S.r.l."), "dussin");
  assert.equal(coreVenueName("Al Giardinetto"), "giardinetto");
});

test("keeps same-name branches in different towns separate", () => {
  const decision = compareVenueRecords(
    osm({ name: "Bar Centrale", postcode: "31046",
      address_components: { locality: "Oderzo", postcode: "31046" } }),
    osm({ name: "Bar Centrale", osm_id: "node/other", postcode: "31100",
      address_components: { locality: "Treviso", postcode: "31100" } }),
  );
  assert.equal(decision.merge, false);
  assert.deepEqual(decision.conflicts.map((item) => item.type).sort(),
    ["municipality_conflict", "postcode_conflict"]);
});

test("merges municipality and frazione labels when postcode and coordinates agree", () => {
  const venues = canonicalizeVenues([
    osm({ name: "Nuovo Ronche", osm_id: "way/1", postcode: "31046",
      address_components: { locality: "Piavon", postcode: "31046" } }),
    { name: "Nuovo Ronche", source: "overture_places", provider_place_id: "place-1",
      postcode: "31046", latitude: 45.78005, longitude: 12.49,
      address_components: { locality: "Oderzo", postcode: "31046" } },
  ], { location: "Oderzo" });
  assert.equal(venues.length, 1);
  assert.equal(venues[0].source_records.length, 2);
});

test("merges a nearby expanded venue name with its shorter core name", () => {
  const venues = canonicalizeVenues([
    osm({ name: "Gaia da Camino", osm_id: "node/1" }),
    { name: "Ristorante Pizzeria Gaia", source: "overture_places", provider_place_id: "place-gaia",
      latitude: 45.78005, longitude: 12.49 },
  ], { location: "Oderzo" });
  assert.equal(venues.length, 1);
  assert.deepEqual(venues[0].aliases, ["Gaia da Camino", "Ristorante Pizzeria Gaia"]);
});

test("rejects a wrong branch despite a matching name and nearby coordinate", () => {
  const decision = compareVenueRecords(
    osm({ name: "Sushi House", phone: "+39 0422 111111", postcode: "31046" }),
    osm({ name: "Sushi House", osm_id: "node/branch", phone: "+39 0422 999999",
      postcode: "31046", latitude: 45.78005 }),
  );
  assert.equal(decision.merge, false);
  assert.ok(decision.conflicts.some((item) => item.type === "phone_conflict"));
});

test("keeps nearby distinct venues at different street numbers separate", () => {
  const decision = compareVenueRecords(
    osm({ name: "Al Ponte", address_components: { street: "Via Roma", house_number: "2" } }),
    osm({ name: "Al Ponte", osm_id: "node/next-door", latitude: 45.78005,
      address_components: { street: "Via Roma", house_number: "4" } }),
  );
  assert.equal(decision.merge, false);
  assert.ok(decision.conflicts.some((item) => item.type === "house_number_conflict"));
});

test("uses source aliases but never publishes an alias-only fuzzy merge", () => {
  const venues = canonicalizeVenues([
    osm({ name: "Casa Uno", aliases: ["Al Giardinetto"], latitude: undefined, longitude: undefined }),
    { name: "Giardinetto", source: "directory_lead", postcode: "31046" },
  ], { location: { municipality: "Oderzo" } });
  assert.equal(venues.length, 2);
});
