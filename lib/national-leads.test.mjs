import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { EvidenceStore } from "./evidence-store.mjs";
import { buildMapSnapshot, readMapSnapshot, snapshotPathFor, writeMapSnapshot } from "./map-snapshot.mjs";
import { leadFixtureStore } from "./national-leads.fixture.mjs";
import { dayNumber, LeadIndex, normalize, parseFilters, TABLE_SORTS } from "./national-leads.mjs";
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

  const towns = index.towns();
  assert.equal(towns.reduce((sum, town) => sum + town[2], 0), 7, "every venue belongs to one town");
  assert.ok(towns.every((town, k) => k === 0 || towns[k - 1][2] >= town[2]), "busiest towns first");
  assert.deepEqual(towns.find((town) => town[1] === "VE"), [venice.name, "VE", 2]);
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

test("the CRM overlay changes statuses and stages, filters by stage, and changes the version", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  const base = index.version;
  const clusters = index.allClusters;
  index.applyOverlay({ key: "empty" });
  assert.equal(index.version, base, "an empty overlay changes nothing");
  assert.equal(index.allClusters, clusters, "and rebuilds nothing");
  index.applyOverlay({ stage: new Map([["venue:ok", "shortlisted"]]), key: "stage-only" });
  assert.notEqual(index.version, base);
  assert.equal(index.allClusters, clusters, "a stage change keeps the unfiltered clusters");
  assert.equal(index.summary(filters("stage=shortlisted")).total.matching, 1);
  const unchecked = index.columns.id[index.status.indexOf(5)];
  index.applyOverlay({ status: new Map([[unchecked, "verified"]]),
    stage: new Map([["venue:ok", "contacted"], [unchecked, "shortlisted"], ["venue:missing", "won"]]),
    key: "overlay-1" });
  assert.notEqual(index.version, base);
  assert.equal(index.meta().statuses.find((entry) => entry.code === "verified").count, 2);
  assert.equal(index.meta().stages.find((entry) => entry.code === "contacted").count, 1);
  assert.equal(index.summary(filters("stage=contacted,shortlisted")).total.matching, 2);
  assert.equal(index.summary(filters("stage=none")).total.matching, 5);
  const facets = index.summary(filters("stage=contacted")).total;
  assert.equal(facets.stage.shortlisted, 1, "the stage facet ignores its own filter");
  assert.equal(facets.status.verified, 1);
  assert.equal(index.venue(index.indexOf("venue:ok")).stage, "contacted");
  assert.equal(index.list(filters(""), null, 0, 2).items.every((item) => item.status === "verified"), true,
    "the list order follows the overlaid status");
  const csv = index.csv(index.exportRows(filters("stage=contacted"), null));
  assert.match(csv, /,pipeline_stage,attribution\r\n/);
  assert.match(csv, /,contacted,Overture/);

  index.applyOverlay();
  assert.equal(index.version, base, "an empty overlay restores the snapshot");
  assert.equal(index.meta().statuses.find((entry) => entry.code === "verified").count, 1);
  assert.equal(index.summary(filters("stage=contacted")).total.matching, 0);
});

test("the table pages every sort without losing or repeating a row, with the map's counts", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  for (const query of ["", "region=12", "status=verified,rejected", "phone=1&cat=bar,pizzeria", "q=caffe"]) {
    const expected = index.summary(filters(query)).total.matching;
    for (const sort of TABLE_SORTS) {
      for (const dir of ["asc", "desc"]) {
        const seen = [];
        for (let offset = 0; offset < 10; offset += 2) {
          const page = index.table(filters(query), { sort, dir, offset, limit: 2 });
          assert.equal(page.total, expected, `${query} ${sort} ${dir}: total equals the map's count`);
          seen.push(...page.items.map((item) => item.id));
        }
        assert.equal(seen.length, expected, `${query} ${sort} ${dir}: every row once`);
        assert.equal(new Set(seen).size, expected);
      }
    }
  }
  const names = (dir) => index.table(filters(""), { sort: "name", dir }).items.map((item) => item.name);
  assert.deepEqual(names("desc"), [...names("asc")].reverse());
  assert.deepEqual(index.table(filters(""), { sort: "status" }).items.map((item) => item.id),
    index.list(filters(""), null, 0, 10).items.map((item) => index.columns.id[item.i]),
    "the default order is the map list's order");
  const row = index.table(filters("status=verified")).items[0];
  assert.equal(row.website, "https://mario.example/");
  assert.equal(row.contacts, 0);
  assert.equal(index.table(filters(""), { sort: "bogus", limit: 999 }).sort, "status");
});

test("the CRM overlay feeds the table's columns, due filters, and sorts", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  const today = dayNumber("2026-09-28");
  const at = (query) => parseFilters(new URLSearchParams(query), { today });
  const ids = index.columns.id;
  const [a, b, c] = [ids[0], ids[1], ids[2]];
  const baseVersion = index.version;
  const tableVersion = index.tableVersion();
  index.applyOverlay({
    stage: new Map([[a, "contacted"], [b, "follow_up"], [c, "shortlisted"]]),
    crm: new Map([
      [a, { next_action: "Call back", next_action_on: "2026-09-25", last_activity_on: "2026-09-20", contacts: 2 }],
      [b, { next_action: "Visit", next_action_on: "2026-10-02", last_activity_on: "2026-09-27", contacts: 0 }],
      [c, { next_action: "", next_action_on: "", last_activity_on: "", contacts: 1 }],
    ]),
    key: "crm-1",
  });
  assert.notEqual(index.tableVersion(), tableVersion);
  assert.equal(index.table(at("due=overdue")).total, 1);
  assert.equal(index.table(at("due=today")).total, 1);
  assert.equal(index.table(at("due=week")).total, 2);
  assert.equal(index.table(at("due=any")).total, 2);
  assert.equal(index.table(at("due=none")).items[0].id, c, "in the pipeline without a next action");
  assert.equal(index.table(at("contacts=1")).total, 2);
  assert.equal(index.table(at("contacts=0")).total, 5);
  assert.equal(index.summary(at("due=week")).total.matching, 2, "the map's counts use the same filters");
  for (const dir of ["asc", "desc"]) {
    const order = index.table(at(""), { sort: "next_action_on", dir }).items.map((item) => item.id);
    assert.deepEqual(order.slice(0, 2), dir === "asc" ? [a, b] : [b, a], `${dir}: dated rows first`);
  }
  const first = index.table(at(""), { sort: "contacts", dir: "desc" }).items[0];
  assert.equal(first.id, a);
  assert.equal(first.next_action, "Call back");
  assert.equal(first.contacts, 2);

  // A CRM-only change keeps the map's version (its tiles do not show CRM columns).
  const version = index.version;
  index.applyOverlay({ stage: new Map([[a, "contacted"], [b, "follow_up"], [c, "shortlisted"]]),
    crm: new Map([[a, { next_action_on: "2026-09-29", contacts: 2 }]]), key: "crm-2" });
  assert.equal(index.version, version);
  assert.equal(index.table(at("due=overdue")).total, 0, "the cached sort and filter follow the change");
  index.applyOverlay();
  assert.equal(index.version, baseVersion);
  assert.equal(index.tableVersion(), baseVersion);
  assert.equal(index.table(at("due=any")).total, 0);
});

test("names in Unicode compatibility letters sort and search as plain letters", () => {
  assert.equal(normalize("𝗧𝗥𝗔𝗧𝗧𝗢𝗥𝗜𝗔 Caffè"), "trattoria caffe");
});

test("the CSV streams in chunks that join into the same file", (t) => {
  const { path } = fixture(t);
  const index = new LeadIndex(buildMapSnapshot(path, { at: "2026-09-21T00:00:00.000Z" }));
  const rows = index.exportRows(filters(""), null);
  const chunks = [...index.csvChunks(rows, 3)];
  assert.equal(chunks.length, 3, "header plus 7 rows in chunks of 3 lines");
  assert.equal(chunks.join(""), index.csv(rows));
  assert.ok(chunks[0].startsWith("﻿venue_id,"), "the byte-order mark opens the file");
  assert.ok(chunks.every((chunk) => chunk.endsWith("\r\n")));
  assert.equal(index.csv(rows).trim().split("\r\n").length, 8);
});
