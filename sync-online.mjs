#!/usr/bin/env node
// Syncs the laptop with the online lead CRM (PROCESS.md, "Online lead CRM"):
// applies manual decisions made online to the national store, pushes the map
// snapshot and changed venue details, and backs up the CRM tables.
//
//   node --env-file-if-exists=.env sync-online.mjs [--db PATH] [--review-db PATH]
//     [--no-details] [--no-backup] [--migrate-only]
//
// DATABASE_URL is the Neon connection string (web/README.md).
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { connectOnline, migrate } from "./lib/online-db.mjs";
import { syncOnline } from "./lib/online-sync.mjs";

const { values: args } = parseArgs({
  options: {
    db: { type: "string", default: "data/istat/2026-01-01/derived/italy-import.sqlite" },
    "review-db": { type: "string", default: "data/national-review/review.sqlite" },
    "backup-dir": { type: "string", default: "data/online-backups" },
    "no-details": { type: "boolean", default: false },
    "no-backup": { type: "boolean", default: false },
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
      details: !args["no-details"], log: (line) => console.log(line),
    });
    console.log(`sync done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await sql.end();
}
