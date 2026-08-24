import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "..", "output", ".cache");

const TTL = 24 * 60 * 60 * 1000;

const mem = new Map();

function keyFile(key) {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return resolve(CACHE_DIR, `${h}.json`);
}

export async function cacheGet(key) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (hit) mem.delete(key);

  try {
    const raw = await readFile(keyFile(key), "utf-8");
    const entry = JSON.parse(raw);
    if (entry && Date.now() - entry.at < TTL) {
      mem.set(key, entry);
      return entry.value;
    }
  } catch {}
  return null;
}

export async function cacheSet(key, value) {
  const entry = { at: Date.now(), value };
  mem.set(key, entry);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(keyFile(key), JSON.stringify(entry), "utf-8");
  } catch {}
}
