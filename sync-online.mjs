#!/usr/bin/env node
// Syncs the laptop with the online lead CRM (PROCESS.md, "Online lead CRM"):
// applies manual decisions made online to the national store, pushes the map
// snapshot and changed venue details, and backs up the CRM tables.
//
//   node --env-file-if-exists=.env sync-online.mjs [--db PATH] [--review-db PATH]
//     [--no-details] [--no-backup] [--no-reviews] [--migrate-only]
//
// --no-reviews leaves online manual decisions unapplied (web/'s sync:local uses it, so
// test decisions in a local database never reach the real national store).
//
// DATABASE_URL is the Neon connection string (web/README.md).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectOnline, migrate } from "./lib/online-db.mjs";
import { syncOnline } from "./lib/online-sync.mjs";

// Defaults are in the repository, wherever the command is run from (web/ has npm
// scripts for it).
const root = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: resolve(root, "data/istat/2026-01-01/derived/italy-import.sqlite") },
    "review-db": { type: "string", default: resolve(root, "data/national-review/review.sqlite") },
    "backup-dir": { type: "string", default: resolve(root, "data/online-backups") },
    "no-details": { type: "boolean", default: false },
    "no-backup": { type: "boolean", default: false },
    "no-reviews": { type: "boolean", default: false },
    "migrate-only": { type: "boolean", default: false },
  },
});

const sql = connectOnline();
try {
  const applied = await migrate(sql);
  if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
  if (!args["migrate-only"]) {
    const started = Date.now();
    await syncOnline({
      sql, dbPath: resolve(args.db), reviewDbPath: resolve(args["review-db"]),
      backupDir: args["no-backup"] ? null : resolve(args["backup-dir"]),
      details: !args["no-details"], reviews: !args["no-reviews"], log: (line) => console.log(line),
    });
    console.log(`sync done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await sql.end();
}
