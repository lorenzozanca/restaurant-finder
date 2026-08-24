import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { findExpired, enforceRetention, readPolicy } from "./retention.mjs";

test("classifies files and applies category-specific retention", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "restaurant-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const town = resolve(root, "oderzo");
  const cache = resolve(root, ".cache");
  await mkdir(town);
  await mkdir(cache);

  const oldResult = resolve(town, "old.json");
  const recentResult = resolve(town, "recent.json");
  const oldLog = resolve(town, "old.log.json");
  const oldCache = resolve(cache, "response.json");
  const unknown = resolve(town, "notes.txt");
  for (const file of [oldResult, recentResult, oldLog, oldCache, unknown]) {
    await writeFile(file, "{}");
  }

  const now = Date.UTC(2026, 7, 24);
  const old = new Date(now - 40 * 24 * 60 * 60 * 1000);
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000);
  for (const file of [oldResult, oldLog, oldCache, unknown]) await utimes(file, old, old);
  await utimes(recentResult, recent, recent);

  const policy = { results: 30, logs: 14, cache: 1 };
  const expired = await findExpired(root, policy, now);
  assert.deepEqual(expired.map((item) => item.kind).sort(), ["cache", "logs", "results"]);

  await enforceRetention(root, { policy, now, apply: true });
  for (const file of [oldResult, oldLog, oldCache]) {
    await assert.rejects(access(file), { code: "ENOENT" });
  }
  await access(recentResult);
  await access(unknown);
});

test("policy defaults and rejects invalid overrides", () => {
  assert.deepEqual(readPolicy({}), { results: 30, logs: 14, cache: 1 });
  assert.deepEqual(readPolicy({
    RESULT_RETENTION_DAYS: "60",
    LOG_RETENTION_DAYS: "7",
    CACHE_RETENTION_DAYS: "0.5",
  }), { results: 60, logs: 7, cache: 0.5 });
  assert.throws(() => readPolicy({ RESULT_RETENTION_DAYS: "never" }), /non-negative/);
});
