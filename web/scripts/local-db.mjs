// A local Postgres for developing the online app without Neon: PGlite (Postgres in
// WebAssembly) behind its socket server, kept in web/.local-db. It accepts one
// connection at a time, which web/lib/db.ts respects for local URLs.
//
//   npm run db:local      # then, in web/.env.local:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5434/postgres
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const directory = process.env.LOCAL_DB_DIR
  || join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), ".local-db");
const port = Number(process.env.LOCAL_DB_PORT || 5434);
mkdirSync(directory, { recursive: true });
const db = await PGlite.create(directory);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
await server.start();
console.log(`local database ${directory} on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
