#!/usr/bin/env node
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

export function readPolicy(env = process.env) {
  return {
    results: days(env.RESULT_RETENTION_DAYS, 30, "RESULT_RETENTION_DAYS"),
    logs: days(env.LOG_RETENTION_DAYS, 14, "LOG_RETENTION_DAYS"),
    cache: days(env.CACHE_RETENTION_DAYS, 1, "CACHE_RETENTION_DAYS"),
  };
}

function days(raw, fallback, name) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number of days`);
  }
  return value;
}

export async function findExpired(outputDir, policy = readPolicy(), now = Date.now()) {
  const root = resolve(outputDir);
  const files = await walk(root);
  const expired = [];

  for (const path of files) {
    const kind = classify(root, path);
    if (!kind) continue;
    const info = await stat(path);
    const ageMs = now - info.mtimeMs;
    if (ageMs >= policy[kind] * DAY_MS) {
      expired.push({ path, kind, ageDays: ageMs / DAY_MS });
    }
  }
  return expired.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function classify(root, path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") return null;
  if (rel.startsWith(`.cache${sep}`)) return "cache";
  if (rel.endsWith(".log.json")) return "logs";
  if (rel.endsWith(".json")) return "results";
  return null;
}

export async function enforceRetention(outputDir, options = {}) {
  const expired = await findExpired(outputDir, options.policy, options.now);
  if (options.apply) {
    for (const item of expired) await unlink(item.path);
  }
  return expired;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dirIndex = args.indexOf("--output-dir");
  if (args.some((arg, index) =>
    arg !== "--apply" && arg !== "--output-dir" && index !== dirIndex + 1)) {
    throw new Error("usage: node retention.mjs [--apply] [--output-dir PATH]");
  }
  if (dirIndex !== -1 && !args[dirIndex + 1]) {
    throw new Error("--output-dir requires a path");
  }

  const outputDir = resolve(dirIndex === -1 ? "output" : args[dirIndex + 1]);
  const policy = readPolicy();
  const expired = await enforceRetention(outputDir, { apply, policy });
  const verb = apply ? "Deleted" : "Would delete";

  for (const item of expired) {
    console.log(`${verb} ${relative(outputDir, item.path)} (${item.kind}, ${item.ageDays.toFixed(1)} days old)`);
  }
  console.log(`${apply ? "Deleted" : "Dry run:"} ${expired.length} expired file(s).`);
  if (!apply && expired.length) console.log("Run again with --apply to enforce retention.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
