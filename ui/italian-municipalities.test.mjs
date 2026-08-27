import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(
  new URL("./italian-municipalities.json", import.meta.url),
  "utf-8",
));

test("municipality picker data has valid province relationships", () => {
  const provinces = new Map(data.provinces);

  assert.equal(data.towns.length, 7_894);
  assert.equal(provinces.size, 110);
  for (const [town, province] of data.towns) {
    assert.ok(town);
    assert.ok(provinces.has(province), `${town} refers to unknown province ${province}`);
  }

  assert.deepEqual(data.towns.find(([town]) => town === "Oderzo"), ["Oderzo", "TV"]);
});

test("municipality picker data includes the current 2026 changes", () => {
  assert.deepEqual(data.towns.find(([town]) => town === "Castegnero Nanto"), ["Castegnero Nanto", "VI"]);
  assert.equal(data.towns.some(([town]) => town === "Lirio"), false);
  assert.equal(new Map(data.provinces).get("SU"), "Sulcis Iglesiente");
  assert.equal(data.provinces.some(([code]) => code === "CI"), false);
});

test("same-name municipalities remain separate choices", () => {
  assert.deepEqual(
    data.towns.filter(([town]) => town === "Castro"),
    [["Castro", "BG"], ["Castro", "LE"]],
  );
});
