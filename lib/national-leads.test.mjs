import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./evidence-store.mjs";
import { buildMapSnapshot, readMapSnapshot, snapshotPathFor, writeMapSnapshot } from "./map-snapshot.mjs";
import { leadFixtureStore } from "./national-leads.fixture.mjs";
import { LeadIndex, parseFilters } from "./national-leads.mjs";
import { NationalMapService } from "./national-map-service.mjs";

const at = "2026-09-20T00:00:00.000Z";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "national-leads-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "national.sqlite");
  leadFixtureStore(path);
  return { directory, path };
}

const filters = (query) => parseFilters(new URLSearchParams(query));

test("the snapshot gives every venue exactly one lead status", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  const status = Object.fromEntries(index.meta().statuses.map((entry) => [entry.code, entry.count]));
  assert.deepEqual(status, { verified: 1, rejected: 1, directory: 1, unresolved: 1, unreachable: 1,
    unchecked: 1, no_website: 1 });
  const dead = index.venue(index.columns.id.indexOf("venue:dead"));
  assert.equal(dead.status, "unreachable");
  assert.equal(dead.failure, "ENOTFOUND");
  assert.equal(index.venue(index.columns.id.indexOf("venue:ok")).verified_url, "https://mario.example/");
  assert.deepEqual(index.meta().regions.map((region) => region.name), ["Lazio", "Veneto"]);
});

test("filters, facet counts, list order, and locate", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  assert.equal(index.summary(filters("region=12")).total.matching, 4);
  assert.equal(index.summary(filters("prov=VE&status=verified")).total.matching, 1);
  assert.equal(index.summary(filters("phone=1")).total.matching, 6);
  assert.equal(index.summary(filters("q=caffe")).total.matching, 1, "search ignores accents");
  // Each facet ignores its own filter so the chips show what selecting them would give.
  const facets = index.summary(filters("status=verified&cat=pizzeria,bar")).total;
  assert.equal(facets.matching, 1);
  assert.equal(facets.status.rejected, 1, "the rejected bar is counted under status");
  assert.equal(facets.category.bar, 0, "no verified bar");
  assert.equal(facets.category.pizzeria, 1);
  const rome = index.summary(filters(""), [12.4, 41.8, 12.6, 42]);
  assert.equal(rome.in_view.matching, 4);
  assert.equal(rome.total.matching, 7);

  const list = index.list(filters(""), null, 0, 3);
  assert.equal(list.total, 7);
  assert.deepEqual(list.items.map((item) => item.status), ["verified", "rejected", "directory"]);
  assert.equal(index.list(filters(""), null, 5, 50).items.length, 2);

  const venice = index.locate("venezia", "VE");
  assert.equal(venice.count, 2);
  assert.equal(index.locate("Nowhere"), null);
});

test("tiles show clusters far away and individual venues with their status up close", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  // Zoom 5, the tile holding northern and central Italy (512 px tiles).
  const far = index.tile(filters(""), 5, 8, 5);
  const farCount = far.c.filter((_, k) => k % 5 === 2).reduce((a, b) => a + b, 0) + far.p.length / 4;
  assert.equal(farCount, 7);
  assert.ok(far.c.length > 0, "nearby venues merge into clusters");
  const verifiedInClusters = far.c.filter((_, k) => k % 5 === 3).reduce((a, b) => a + b, 0);
  assert.equal(verifiedInClusters + far.p.filter((_, k) => k % 4 === 3 && far.p[k] === 0).length, 1);
  // Zoom 18 over Rome: individual venues with their status code.
  const x = Math.floor((12.5 / 360 + 0.5) * 2 ** 17);
  const y = Math.floor((0.5 - Math.log(Math.tan(Math.PI / 4 + 41.9 * Math.PI / 360)) / (2 * Math.PI)) * 2 ** 17);
  const close = index.tile(filters("region=12"), 18, x, y);
  assert.equal(close.c.length, 0);
  assert.ok(close.p.length >= 4);
});

test("CSV export escapes fields, carries attribution, and samples reproducibly", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  const csv = index.csv(index.exportRows(filters("region=05"), null));
  const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^venue_id,name,category,lead_status/);
  assert.ok(csv.includes('"Bar ""Sole"", Centro"'));
  assert.ok(lines.slice(1).every((line) => line.endsWith("Overture Maps Foundation Places (CDLA-Permissive-2.0)")));
  const first = index.exportRows(filters(""), null, 3, "seed-a");
  assert.equal(first.length, 3);
  assert.deepEqual(index.exportRows(filters(""), null, 3, "seed-a"), first);
  assert.equal(new Set(first).size, 3);
});

test("the map service builds a missing snapshot in the background and follows store changes", async (t) => {
  const { path, directory } = fixture(t);
  const service = new NationalMapService(path, { checkIntervalMs: 0 });
  assert.equal(service.current(), null, "nothing to serve before the first build");
  assert.equal(service.state().building, true);
  await service.building;
  const first = service.current();
  assert.equal(first.n, 7);
  assert.ok(existsSync(snapshotPathFor(path)));
  assert.equal(service.current(), first, "an unchanged store is not rebuilt");
  assert.equal(service.state().building, false);

  const store = new EvidenceStore(path);
  store.recordCandidateAssessment("venue:new", { candidate_url: "https://new.example/",
    final_url: "https://new.example/", assessment_state: "ambiguous", crawl_outcome: "succeeded",
    scores: { identity: 1, geography: 1, officialness: 1 }, evidence: [], candidate_origin: "source_candidate" },
  { checkedAt: at });
  store.close();
  assert.equal(service.current(), first, "the old index answers while the new one builds");
  await service.building;
  const second = service.current();
  assert.notEqual(second, first);
  assert.equal(second.meta().statuses.find((entry) => entry.code === "unchecked").count, 0);
  assert.equal(readMapSnapshot(snapshotPathFor(path)).count, 7);
  assert.equal(writeMapSnapshot(path, join(directory, "copy.json")).count, 7);
});
