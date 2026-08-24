import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheGet, cacheSet } from "./cache.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = resolve(__dirname, "..", "..", "researcher", "scripts", "search.sh");

let lastSearch = 0;
const MIN_INTERVAL = 1_000;

export async function search(query, limit = 10) {
  const key = `search:${query}|${limit}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  // Reserve a launch slot up front so concurrent callers stay at a steady rate.
  const now = Date.now();
  const slot = Math.max(lastSearch + MIN_INTERVAL, now);
  lastSearch = slot;
  const wait = slot - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }

  try {
    const { stdout } = await execFileAsync("bash", [
      SEARCH_SCRIPT,
      "-n",
      String(limit),
      query,
    ], {
      timeout: 50_000,
      maxBuffer: 512 * 1024,
    });

    const results = [];
    const lines = stdout.split("\n");
    const engine = stdout.match(/^#\s+\d+\s+results[^\n]*\svia\s+(\w+)/m)?.[1]
      || "unknown";

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\d+)\. (.+)/);
      if (match) {
        const urlLine = lines[i + 1]?.trim();
        const snippetLine = lines[i + 2]?.trim() || "";
        const url = urlLine && /^https?:\/\//.test(urlLine) ? urlLine : null;
        if (!url) continue;
        results.push({
          title: match[2].replace(/^\s+|\s+$/g, ""),
          url,
          snippet: snippetLine.replace(/^\s+|\s+$/g, ""),
          search_engine: engine,
        });
        i += 2;
      }
    }

    if (results.length > 0) await cacheSet(key, results);
    return results;
  } catch (err) {
    if (err.killed && err.signal === "SIGTERM") {
      console.error(`[search] timed out for: ${query}`);
    } else {
      console.error(`[search] failed for: ${query} — ${err.message}`);
    }
    return [];
  }
}
