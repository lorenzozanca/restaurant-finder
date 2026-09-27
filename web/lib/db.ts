import "server-only";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { rfSql?: Sql };

/**
 * One postgres.js client per server instance. `prepare: false` keeps it usable
 * through Neon's pooled connection string (PgBouncer, transaction mode); locally it
 * talks to the PGlite socket from scripts/local-db.mjs, which takes one connection.
 */
export function db(): Sql {
  if (!globalForDb.rfSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see web/README.md)");
    const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
    globalForDb.rfSql = postgres(url, { max: local ? 1 : 5, prepare: false, onnotice: () => {} });
  }
  return globalForDb.rfSql;
}
