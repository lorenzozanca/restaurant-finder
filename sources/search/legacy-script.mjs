import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const SEARCH_SCRIPT = resolve(here, "..", "..", "..", "researcher", "scripts", "search.sh");

export function createLegacyScriptProvider(options = {}) {
  const run = options.execFile || execFileAsync;
  return {
    name: "legacy_search_script",
    version: "diagnostic-v1",
    endpointVersion: `diagnostic-html:${options.engine || "brave"}`,
    async search(request) {
      const started = Date.now();
      const args = [SEARCH_SCRIPT, "-n", String(request.limit)];
      if (options.engine) args.push("-e", options.engine);
      args.push(request.query);
      const { stdout } = await run("bash", args, {
        timeout: 50_000, maxBuffer: 512 * 1024,
      });
      const results = parseLegacySearchOutput(stdout);
      return {
        provider: results[0]?.search_engine || providerFromOutput(stdout),
        http_status: 200,
        transport_ok: true,
        parse_ok: true,
        raw_count: results.length,
        duration_ms: Date.now() - started,
        rate_headers: {},
        results,
      };
    },
  };
}

export function parseLegacySearchOutput(stdout) {
  const results = [];
  const lines = String(stdout || "").split("\n");
  const engine = providerFromOutput(stdout);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\d+)\. (.+)/);
    if (!match) continue;
    const urlLine = lines[i + 1]?.trim();
    const snippetLine = lines[i + 2]?.trim() || "";
    if (!/^https?:\/\//.test(urlLine || "")) continue;
    results.push({ title: match[2].trim(), url: urlLine, snippet: snippetLine, search_engine: engine });
    i += 2;
  }
  return results;
}

function providerFromOutput(stdout) {
  return String(stdout || "").match(/^#\s+\d+\s+results[^\n]*\svia\s+(\w+)/m)?.[1] || "unknown";
}
