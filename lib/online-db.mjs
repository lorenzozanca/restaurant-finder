import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Connection and migrations for the online CRM database (Neon in production, a
// PGlite socket locally). Used by sync-online.mjs on the laptop; the web app has its
// own connection in web/lib/db.ts.

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web", "db", "migrations");

export function connectOnline(url = process.env.DATABASE_URL, options = {}) {
  if (!url) throw new Error("DATABASE_URL is not set (the Neon connection string; see web/README.md)");
  // prepare: false keeps it usable through Neon's pooler (PgBouncer, transaction mode).
  return postgres(url, { max: 1, prepare: false, onnotice: () => {}, ...options });
}

export async function migrate(sql, directory = MIGRATIONS_DIR) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((row) => row.name));
  const applied = [];
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const text = readFileSync(join(directory, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    applied.push(name);
  }
  return applied;
}
