#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRows, sourceFixtureDocument } from "./select-source-sample.mjs";
import { validateWebFixtureDocument } from "./lib/web-stress-fixture.mjs";

// Writes the next batch of national source candidates (PROCESS.md step 4) in the
// fixture format the frozen reviewer runner reads, so the certified code runs
// unchanged. Order is a fixed hash of the venue ID, which spreads every batch across
// the country; venues already in an earlier batch are skipped.

const CHUNK = 999;

export function nextBatch(rows, alreadyBatched, size) {
  return rows.filter((row) => !alreadyBatched.has(row.venue_id))
    .map((row) => ({ row, order: createHash("sha256").update(row.venue_id).digest("hex") }))
    .sort((left, right) => left.order.localeCompare(right.order))
    .slice(0, size).map(({ row }) => row);
}

export function batchedVenueIds(root) {
  const ids = new Set();
  if (!existsSync(root)) return ids;
  for (const batch of readdirSync(root)) {
    for (const name of readdirSync(join(root, batch)).filter((file) => /^development-\d{3}-\d{3}\.json$/.test(file))) {
      for (const entry of JSON.parse(readFileSync(join(root, batch, name), "utf8")).entries) ids.add(entry.venue_id);
    }
  }
  return ids;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const size = Number(arg("--size", NaN));
  if (!Number.isInteger(size) || size < 1) throw new Error("--size is required");
  const root = resolve(arg("--batches-dir", "data/national-review/batches"));
  const rows = loadRows(resolve(arg("--db", "data/istat/2026-01-01/derived/italy-import.sqlite")));
  const done = batchedVenueIds(root);
  const selected = nextBatch(rows, done, size);
  if (!selected.length) { console.log(JSON.stringify({ remaining: 0 })); process.exit(0); }
  const batchId = `b${String((existsSync(root) ? readdirSync(root).length : 0) + 1).padStart(3, "0")}`;
  const directory = join(root, batchId);
  mkdirSync(directory, { recursive: true });
  const retrievedAt = new Date().toISOString();
  for (let start = 0, chunk = 1; start < selected.length; start += CHUNK, chunk++) {
    const slice = selected.slice(start, start + CHUNK);
    const fingerprint = createHash("sha256").update(JSON.stringify({ batchId, chunk,
      venues: slice.map((row) => [row.venue_id, row.url]) })).digest("hex");
    const document = sourceFixtureDocument(slice, { partition: "development", fingerprint, retrievedAt });
    document.fixture_set = `national-review-${batchId}`;
    validateWebFixtureDocument(document, { expectedEntries: slice.length });
    const index = String(chunk).padStart(3, "0");
    writeFileSync(join(directory, `development-${index}-${index}.json`), `${JSON.stringify(document)}\n`);
  }
  console.log(JSON.stringify({ batch: batchId, directory, venues: selected.length,
    previously_batched: done.size, remaining_after: rows.length - done.size - selected.length }));
}
