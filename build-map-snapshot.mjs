#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { snapshotPathFor, writeMapSnapshot } from "./lib/map-snapshot.mjs";

// Rebuilds the national map snapshot. The map server also does this by itself
// when the national store changes; run it by hand after bulk edits to have the new
// snapshot ready before the server next looks.

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const databasePath = resolve(arg("--db", "data/istat/2026-01-01/derived/italy-import.sqlite"));
  const started = Date.now();
  const result = writeMapSnapshot(databasePath, resolve(arg("--output", snapshotPathFor(databasePath))));
  console.log(JSON.stringify({ ...result, ms: Date.now() - started }));
}
