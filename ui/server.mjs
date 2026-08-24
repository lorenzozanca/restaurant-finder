import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = __dirname;
const OUTPUT_DIR = resolve(__dirname, "..", "output");
const DISCOVER = resolve(__dirname, "..", "discover.mjs");
const PORT = Number(process.env.PORT || 4188);

const CTYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let runningScan = null;
// Kept after a scan finishes so a page reload can restore the last run's
// results and full log instead of showing an empty form.
let lastScan = null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      await serveStatic(req, res, url);
    } else if (url.pathname === "/api/scan" && req.method === "POST") {
      await handleScan(req, res);
    } else if (url.pathname === "/api/scan/status" && req.method === "GET") {
      await handleScanStatus(req, res);
    } else if (url.pathname === "/api/scan/cancel" && req.method === "POST") {
      handleScanCancel(req, res);
    } else if (url.pathname === "/api/scan/attach" && req.method === "POST") {
      await handleScanAttach(req, res);
    } else if (url.pathname === "/api/scans" && req.method === "GET") {
      await handleScans(req, res);
    } else if (url.pathname === "/api/map" && req.method === "GET") {
      await handleMap(req, res);
    } else if (url.pathname.startsWith("/api/scan/")) {
      await handleScanGet(req, res, url);
    } else {
      json(res, 404, { error: "not found" });
    }
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { error: err.message || "internal error" });
    }
  }
});

async function serveStatic(_req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = resolve(UI_DIR, "." + filePath);

  if (!filePath.startsWith(UI_DIR)) {
    return json(res, 403, { error: "forbidden" });
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CTYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

async function handleScan(req, res) {
  if (runningScan) {
    if (!runningScan.scanComplete) {
      return json(res, 409, {
        error: "Scan already in progress",
        attachable: true,
        town: runningScan.town,
        province: runningScan.province || "",
        startedAt: runningScan.startedAt,
      });
    }
    runningScan = null;
  }

  const body = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }

  const town = String(parsed.town || "").trim();
  if (!town) {
    return json(res, 400, { error: "town is required" });
  }

  const province = String(parsed.province || "").trim();
  const args = [DISCOVER, town];
  if (province) args.push(province);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const proc = spawn("node", args, {
    cwd: resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });

  lastScan = null;
  runningScan = {
    proc, town, province, startedAt: Date.now(),
    clients: new Set([res]),
    cancelled: false,
    resultPath: "",
    scanComplete: false,
    error: null,
    log: [],
    progress: { phase: "discovery", sources: {}, resourcesTotal: 0, resourcesDone: 0 },
  };
  const timer = setTimeout(() => {
    if (runningScan) runningScan.cancelled = true;
    try { proc.kill("SIGTERM"); } catch {}
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 5000);
  }, 30 * 60 * 1000);

  let stdoutBuf = "";
  let stderrBuf = "";

  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Phase markers are printed flush-left; per-venue lines like
      // "  [1/3] Trattoria ..." are indented, so match on the raw line.
      if (line.startsWith("[1/3]")) {
        runningScan.progress.phase = "discovery";
        broadcast("phase", { phase: "discovery" });
      } else if (line.startsWith("[2/3]")) {
        runningScan.progress.phase = "resources";
        broadcast("phase", { phase: "resources" });
      } else if (line.startsWith("[3/3]")) {
        runningScan.progress.phase = "writing";
        broadcast("phase", { phase: "writing" });
      }

      const srcMatch = trimmed.match(/^\s*(nominatim|web search|paginegialle):\s*(\d+)/);
      if (srcMatch) {
        const sourceName = srcMatch[1] === "web search" ? "web_search" : srcMatch[1];
        runningScan.progress.sources[sourceName] = parseInt(srcMatch[2]);
        broadcast("progress", { count: parseInt(srcMatch[2]), source: sourceName });
      }

      const totalMatch = trimmed.match(/^\s*total raw:\s*(\d+)/);
      if (totalMatch) {
        runningScan.progress.sources.total_raw = parseInt(totalMatch[1]);
        broadcast("progress", { count: parseInt(totalMatch[1]), source: "total_raw" });
      }

      const dedupMatch = trimmed.match(/^\s*after dedup.*?(\d+)\s+restaurants/);
      if (dedupMatch) {
        runningScan.progress.sources.deduped = parseInt(dedupMatch[1]);
        broadcast("progress", { count: parseInt(dedupMatch[1]), source: "deduped" });
      }

      const resMatch = trimmed.match(/^\s*\[(\d+)\/(\d+)\]\s+(.+?)\s+\.{3}\s+(.+)/);
      if (resMatch) {
        const name = resMatch[3];
        const tail = resMatch[4];
        let found = 0;
        if (tail === "no resources found") {
          found = 0;
        } else {
          const fMatch = tail.match(/^(\d+)\s+source/);
          if (fMatch) found = parseInt(fMatch[1]);
        }
        runningScan.progress.resourcesDone = parseInt(resMatch[1]);
        runningScan.progress.resourcesTotal = parseInt(resMatch[2]);
        broadcast("resources-progress", {
          n: parseInt(resMatch[1]),
          total: parseInt(resMatch[2]),
          name,
          found,
        });
      }

      const doneMatch = trimmed.match(/✅\s+Done\.\s+\d+\s+restaurants\s+→\s+(.+)/);
      if (doneMatch) {
        runningScan.resultPath = doneMatch[1].trim();
        runningScan.scanComplete = true;
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  proc.on("close", async (code) => {
    clearTimeout(timer);

    let result = null;
    if (runningScan.scanComplete && runningScan.resultPath) {
      try {
        const data = await readFile(runningScan.resultPath, "utf-8");
        result = JSON.parse(data);
        broadcast("result", result);
      } catch (err) {
        runningScan.error = `Failed to read result: ${err.message}`;
        broadcast("error", { error: runningScan.error });
      }
    } else if (!runningScan.scanComplete) {
      const msg = runningScan.cancelReason
        || (runningScan.cancelled ? "Scan timed out" : stderrBuf.trim() || (code === null ? "timeout" : `exit code ${code}`));
      runningScan.error = msg;
      broadcast("error", { error: msg });
    }

    lastScan = {
      town: runningScan.town,
      province: runningScan.province || "",
      startedAt: runningScan.startedAt,
      finishedAt: Date.now(),
      log: runningScan.log,
      error: runningScan.error || null,
      result,
    };
    if (result) await saveLog(runningScan.resultPath, runningScan.log);

    for (const client of runningScan.clients) {
      try { client.end(); } catch {}
    }
    runningScan = null;
  });

  req.on("close", () => {
    if (runningScan && runningScan.clients) {
      runningScan.clients.delete(res);
    }
  });
}

async function handleScanStatus(_req, res) {
  if (!runningScan) {
    return json(res, 200, { running: false, last: lastScan });
  }
  json(res, 200, {
    running: true,
    town: runningScan.town,
    province: runningScan.province || "",
    startedAt: runningScan.startedAt,
    elapsed: Date.now() - runningScan.startedAt,
    completed: runningScan.scanComplete,
    error: runningScan.error || null,
    progress: runningScan.progress,
    log: runningScan.log,
  });
}

// Store the event log next to the result JSON: output/<town>/<date>.log.json
async function saveLog(resultPath, log) {
  if (!resultPath) return;
  try {
    const logPath = resultPath.replace(/\.json$/, ".log.json");
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, JSON.stringify(log), "utf-8");
  } catch {}
}

async function handleScanAttach(req, res) {
  if (!runningScan) {
    return json(res, 404, { error: "no scan in progress" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  runningScan.clients.add(res);

  sse(res, "attached", {
    town: runningScan.town,
    province: runningScan.province || "",
    progress: runningScan.progress,
    elapsed: Date.now() - runningScan.startedAt,
    log: runningScan.log,
  });

  req.on("close", () => {
    if (runningScan && runningScan.clients) {
      runningScan.clients.delete(res);
    }
  });
}

function handleScanCancel(_req, res) {
  if (!runningScan) return json(res, 200, { cancelled: false });
  runningScan.cancelled = true;
  runningScan.cancelReason = "Scan cancelled";
  const proc = runningScan.proc;
  try { proc.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000);
  json(res, 200, { cancelled: true });
}

async function handleScans(_req, res) {
  const scans = [];

  if (!existsSync(OUTPUT_DIR)) {
    return json(res, 200, scans);
  }

  const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const dirPath = resolve(OUTPUT_DIR, entry.name);
    const files = await readdir(dirPath);
    const jsonFiles = files
      .filter((f) => f.endsWith(".json") && !f.endsWith(".log.json"))
      .sort()
      .reverse();

    if (jsonFiles.length === 0) continue;

    let totalFound = 0;
    let withResources = 0;
    const dates = [];

    for (const f of jsonFiles.slice(0, 5)) {
      const date = f.replace(".json", "");
      dates.push(date);
    }

    try {
      const latest = jsonFiles[0];
      const data = JSON.parse(await readFile(resolve(dirPath, latest), "utf-8"));
      totalFound = data.total_found || 0;
      withResources = data.with_resources || data.with_menu || 0;
    } catch {}

    scans.push({
      town: capitalizeTown(entry.name),
      town_slug: entry.name,
      dates,
      restaurants: totalFound,
      with_resources: withResources,
    });
  }

  scans.sort((a, b) => a.town.localeCompare(b.town, "it"));
  json(res, 200, scans);
}

async function handleMap(_req, res) {
  if (!existsSync(OUTPUT_DIR)) {
    return json(res, 200, { restaurants: [], towns: [] });
  }

  const byKey = new Map();
  const towns = new Set();
  const entries = await readdir(OUTPUT_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dirPath = resolve(OUTPUT_DIR, entry.name);
    const files = (await readdir(dirPath))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".log.json"))
      .sort()
      .reverse();
    if (!files.length) continue;

    let data;
    try {
      data = JSON.parse(await readFile(resolve(dirPath, files[0]), "utf-8"));
    } catch {
      continue;
    }

    const town = data.location
      ? (data.province ? `${data.location} (${data.province})` : data.location)
      : capitalizeTown(entry.name);
    let townHasLocations = false;

    for (const r of data.restaurants || []) {
      const latitude = Number(r.latitude);
      const longitude = Number(r.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
          || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
      townHasLocations = true;

      const normalizedName = String(r.name || "restaurant").toLowerCase().replace(/\W+/g, " ").trim();
      const key = r.osm_id
        ? `osm:${r.osm_id}`
        : `place:${normalizedName}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
      const resources = r.resources || r.menu_sources || [];
      const existing = byKey.get(key);

      if (existing) {
        if (r.address && !existing.address) existing.address = r.address;
        if (r.cuisine && !existing.cuisine) existing.cuisine = r.cuisine;
        existing.resource_count = Math.max(existing.resource_count, resources.length);
        if (!existing.towns.includes(town)) existing.towns.push(town);
        continue;
      }

      byKey.set(key, {
        name: r.name || "Restaurant",
        address: r.address || "",
        type: r.type || "restaurant",
        cuisine: r.cuisine || "",
        latitude,
        longitude,
        resource_count: resources.length,
        towns: [town],
      });
    }
    if (townHasLocations) towns.add(town);
  }

  const restaurants = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
  json(res, 200, {
    restaurants,
    towns: [...towns].sort((a, b) => a.localeCompare(b, "it")),
  });
}

async function handleScanGet(_req, res, url) {
  const parts = decodeURIComponent(url.pathname).replace(/^\/api\/scan\//, "").split("/");
  if (parts.length === 0) return json(res, 400, { error: "invalid path" });

  const townSlug = parts[0].toLowerCase();
  const dirPath = resolve(OUTPUT_DIR, townSlug);

  if (!existsSync(dirPath)) {
    return json(res, 404, { error: "town not found" });
  }

  const wantLog = parts[2] === "log";
  const suffix = wantLog ? ".log.json" : ".json";

  let filename;
  if (parts[1] === "latest") {
    const files = await readdir(dirPath);
    const jsons = files.filter((f) => f.endsWith(".json") && !f.endsWith(".log.json")).sort().reverse();
    if (jsons.length === 0) return json(res, 404, { error: "no scans for town" });
    filename = wantLog ? jsons[0].replace(/\.json$/, suffix) : jsons[0];
  } else if (parts[1]) {
    filename = parts[1] + suffix;
  } else {
    return json(res, 400, { error: "date or 'latest' required" });
  }

  if (filename.includes("/") || filename.includes("..")) {
    return json(res, 400, { error: "invalid path" });
  }

  try {
    const data = await readFile(resolve(dirPath, filename), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(data);
  } catch {
    json(res, 404, { error: "scan not found" });
  }
}

// Every progress event is appended to runningScan.log so that a client which
// reloads (or connects late) can replay the whole run, not just the tail.
function broadcast(event, data) {
  if (!runningScan) return;
  if (event !== "result") {
    runningScan.log.push({ event, data, at: Date.now() - runningScan.startedAt });
  }
  for (const client of runningScan.clients) {
    try { sse(client, event, data); } catch {}
  }
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function capitalizeTown(slug) {
  return slug
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function shutdown() {
  if (runningScan) {
    try { runningScan.proc.kill("SIGKILL"); } catch {}
    runningScan = null;
  }
  server.close(() => process.exit(0));
}

server.listen(PORT, () => {
  console.log(`restaurant-finder UI — http://localhost:${PORT}`);
});
