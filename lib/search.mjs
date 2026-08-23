import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = resolve(__dirname, "..", "..", "scripts", "search.sh");

let lastSearch = 0;
const MIN_INTERVAL = 12_000;

export async function search(query, limit = 10) {
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastSearch);
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
    lastSearch = Date.now();

    const results = [];
    const lines = stdout.split("\n");

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
        });
        i += 2;
      }
    }
    return results;
  } catch (err) {
    lastSearch = Date.now();
    if (err.killed && err.signal === "SIGTERM") {
      console.error(`[search] timed out for: ${query}`);
    } else {
      console.error(`[search] failed for: ${query} — ${err.message}`);
    }
    return [];
  }
}