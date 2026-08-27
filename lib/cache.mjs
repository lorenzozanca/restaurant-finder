import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_DIR = resolve(__dirname, "..", "output", ".cache");

const TTL = 24 * 60 * 60 * 1000;

const mem = new Map();

function keyFile(key, cacheDir) {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return resolve(cacheDir, `${h}.json`);
}

export async function cacheGet(key, options = {}) {
  const cacheDir = configuredCacheDir(options.cacheDir);
  const memoryKey = `${cacheDir}\0${key}`;
  const now = options.now?.() ?? Date.now();
  const hit = mem.get(memoryKey);
  if (hit && isFresh(hit, now, options.ttlMs)) return hit.value;
  if (hit) mem.delete(memoryKey);

  try {
    const raw = await readFile(keyFile(key, cacheDir), "utf-8");
    const entry = JSON.parse(raw);
    if (entry && isFresh(entry, now, options.ttlMs)) {
      mem.set(memoryKey, entry);
      return entry.value;
    }
  } catch {}
  return null;
}

export async function cacheSet(key, value, options = {}) {
  const cacheDir = configuredCacheDir(options.cacheDir);
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? TTL;
  const entry = { at: now, expires_at: now + ttlMs, ttl_ms: ttlMs, value };
  mem.set(`${cacheDir}\0${key}`, entry);
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(keyFile(key, cacheDir), JSON.stringify(entry), "utf-8");
  } catch {}
}

export function configuredCacheDir(override) {
  return resolve(override || process.env.CACHE_DIR || DEFAULT_CACHE_DIR);
}

function isFresh(entry, now, ttlOverride) {
  if (!entry || !Number.isFinite(entry.at)) return false;
  const expiresAt = ttlOverride === undefined
    ? (Number.isFinite(entry.expires_at) ? entry.expires_at : entry.at + TTL)
    : entry.at + ttlOverride;
  return now < expiresAt;
}
