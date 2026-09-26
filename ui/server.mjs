import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { recordReviewDecision, venueReview } from "../lib/review-queue.mjs";
import { gzipSync } from "node:zlib";
import { NationalMapService } from "../lib/national-map-service.mjs";
import { parseBbox, parseFilters } from "../lib/national-leads.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = __dirname;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const PORT = Number(process.env.PORT || 4188);
const HOST = process.env.HOST || (isMain ? tailscaleAddress() : "127.0.0.1") || "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_NATIONAL_DB = resolve(__dirname, "..", "data", "istat", "2026-01-01", "derived", "italy-import.sqlite");
// Batch review database of the certified LLM reviewer; the venue card shows its reasons.
const DEFAULT_REVIEW_DB = resolve(__dirname, "..", "data", "national-review", "review.sqlite");
// The app has no authentication of its own, so it only binds where every peer is
// already authenticated: loopback, or a Tailscale address whose tailnet ACLs decide
// who can reach it. Any wider interface stays opt-in. See PRIVACY.md, "Security".
const WIDE_BIND = process.env.ALLOW_WIDE_BIND === "1";
// Extra Host header values to accept, comma separated, for names that do not resolve
// here (a reverse proxy, or a MagicDNS short name).
const EXTRA_HOSTS = (process.env.ALLOWED_HOSTS || "").split(",").map((v) => v.trim()).filter(Boolean);

const CTYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

let nationalMapService = null;

const server = createServer(handle);
// Bound in addition to a tailnet HOST so http://localhost:PORT keeps working on this
// machine; a listener is per address, and loopback is already an allowed peer.
const loopbackServer = isLoopback(HOST) ? null : createServer(handle);

export async function handle(req, res) {
  if (!hostAllowed(req.headers.host) || !originAllowed(req)) {
    json(res, 403, { error: "host not allowed" });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      await serveStatic(req, res, url);
    } else if (url.pathname.startsWith("/api/national/") && req.method === "GET") {
      handleNational(req, res, url);
    } else if (url.pathname === "/api/national/review" && req.method === "POST") {
      await handleReviewDecision(req, res);
    } else {
      json(res, 404, { error: "not found" });
    }
  } catch (err) {
    if (!res.headersSent) {
      json(res, err.statusCode || 500, { error: err.message || "internal error" });
    }
  }
}

async function serveStatic(_req, res, url) {
  // The national map is the product; the old town scanner and review pages are gone.
  if (["/", "/index.html", "/review.html"].includes(url.pathname)) {
    res.writeHead(302, { Location: `/map.html${url.search}` });
    return res.end();
  }
  const filePath = resolve(UI_DIR, "." + url.pathname);

  if (!filePath.startsWith(UI_DIR)) {
    return json(res, 403, { error: "forbidden" });
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const headers = { "Content-Type": CTYPES[ext] || "application/octet-stream" };
    // Vendored libraries are versioned by path; the app's own pages revalidate.
    headers["Cache-Control"] = url.pathname.startsWith("/vendor/") ? "public, max-age=604800" : "no-cache";
    if (/^(text\/|application\/(javascript|json|geo\+json)|image\/svg)/.test(headers["Content-Type"])) {
      send(_req, res, data, headers);
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

function nationalService() {
  const dbPath = resolve(String(process.env.NATIONAL_DB_PATH || DEFAULT_NATIONAL_DB));
  if (!nationalMapService || nationalMapService.databasePath !== dbPath) {
    nationalMapService = new NationalMapService(dbPath);
  }
  return nationalMapService;
}

// National lead map API (lib/national-leads.mjs). Tiles carry the snapshot
// version in their URL, so they are cached by the browser until the next publish.
function handleNational(req, res, url) {
  const service = nationalService();
  const index = service.current();
  if (!index) {
    return json(res, 503, { error: service.state().error || "the map is being prepared", ...service.state() });
  }
  const route = url.pathname.slice("/api/national/".length);
  const params = url.searchParams;
  const filters = parseFilters(params);
  const bbox = parseBbox(params.get("bbox"));
  if (route === "meta") return sendJson(req, res, { ...index.meta(), building: service.state().building });
  const tile = route.match(/^tile\/(\d{1,2})\/(\d+)\/(\d+)$/);
  if (tile) {
    const [z, x, y] = tile.slice(1).map(Number);
    if (z > 22 || x >= 2 ** z || y >= 2 ** z) return json(res, 400, { error: "invalid tile" });
    const cache = params.get("v") === index.version ? "public, max-age=86400, immutable" : "no-cache";
    return sendJson(req, res, index.tile(filters, z, x, y), cache);
  }
  if (route === "summary") return sendJson(req, res, index.summary(filters, bbox));
  if (route === "list") {
    const offset = Math.max(0, Number.parseInt(params.get("offset"), 10) || 0);
    const limit = Number.parseInt(params.get("limit"), 10) || 50;
    return sendJson(req, res, index.list(filters, bbox, offset, limit));
  }
  const venue = route.match(/^venue\/(\d+)$/);
  if (venue) {
    if (params.get("v") && params.get("v") !== index.version) return json(res, 409, { error: "map updated", v: index.version });
    const detail = index.venue(Number(venue[1]));
    return detail ? sendJson(req, res, detail) : json(res, 404, { error: "venue not found" });
  }
  const review = route.match(/^review\/(\d+)$/);
  if (review) {
    if (params.get("v") && params.get("v") !== index.version) return json(res, 409, { error: "map updated", v: index.version });
    const detail = index.venue(Number(review[1]));
    if (!detail) return json(res, 404, { error: "venue not found" });
    return sendJson(req, res, venueReview(service.databasePath, detail.id, { sourceUrl: detail.candidate_url,
      reviewDbPath: resolve(String(process.env.NATIONAL_REVIEW_DB_PATH || DEFAULT_REVIEW_DB)) }));
  }
  if (route === "locate") {
    const place = index.locate(params.get("name") || "", params.get("prov") || "");
    return place ? sendJson(req, res, place) : json(res, 404, { error: "municipality not found" });
  }
  if (route === "towns") return sendJson(req, res, { v: index.version, towns: index.towns() });
  if (route === "export.csv") {
    const sample = Math.max(0, Number.parseInt(params.get("sample"), 10) || 0);
    const rows = index.exportRows(filters, bbox, sample, params.get("seed") || "");
    const body = index.csv(rows);
    const name = `venues-${new Date().toISOString().slice(0, 10)}-${rows.length}.csv`;
    return send(req, res, body, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });
  }
  return json(res, 404, { error: "not found" });
}

function sendJson(req, res, data, cacheControl = "no-cache") {
  return send(req, res, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl,
  });
}

function send(req, res, body, headers) {
  const buffer = Buffer.from(body);
  if (buffer.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    return res.end(gzipSync(buffer));
  }
  res.writeHead(200, { ...headers, Vary: "Accept-Encoding" });
  return res.end(buffer);
}

// Manual ownership review from the venue card (lib/review-queue.mjs). An approval
// publishes the website to the national store; the map snapshot is rebuilt at once,
// so the venue changes colour on the map a few seconds later. The store must
// already exist: a wrong path must answer 503, never create an empty store.
async function handleReviewDecision(req, res) {
  const service = nationalService();
  if (!existsSync(service.databasePath)) return json(res, 503, { error: "national store not found" });
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    if (error.statusCode) throw error;
    return json(res, 400, { error: "invalid JSON" });
  }
  let attestation;
  try {
    attestation = recordReviewDecision(service.databasePath, parsed);
  } catch (error) {
    return json(res, 400, { error: error.message || "invalid review decision" });
  }
  service.storeChanged();
  json(res, 200, attestation);
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        const error = new Error("request body too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!rejected) resolve(body);
    });
    req.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

function shutdown() {
  let open = loopbackServer ? 2 : 1;
  const done = () => { if (--open === 0) process.exit(0); };
  server.close(done);
  loopbackServer?.close(done);
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

// Tailscale hands out CGNAT addresses from 100.64.0.0/10 and MagicDNS names under
// *.ts.net; both are reachable only from an authenticated device on the tailnet.
function isTailnet(host) {
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (octets) return Number(octets[1]) === 100 && Number(octets[2]) >= 64 && Number(octets[2]) <= 127;
  return host.endsWith(".ts.net");
}

// With no HOST given, prefer this machine's own Tailscale address over loopback: the
// tailnet is an authenticated network, so binding it is within the policy above, and
// it means a caller that cannot pass HOST still gets a link that works from the phone.
function tailscaleAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && isTailnet(address.address)) return address.address;
    }
  }
  return "";
}

// A Host header the browser was not sent to means DNS rebinding: some other name now
// points at this address. Compare the name only; the port is fixed by the listener.
function hostAllowed(header) {
  if (!header) return false;
  const name = header.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopback(name) || name === HOST.toLowerCase()) return true;
  if (EXTRA_HOSTS.includes(name)) return true;
  return isTailnet(HOST) && isTailnet(name);
}

function originAllowed(req) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return hostAllowed(new URL(origin).host); } catch { return false; }
}

if (isMain) {
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  if (!isLoopback(HOST) && !isTailnet(HOST) && !WIDE_BIND) {
    console.error(
      `refusing to bind ${HOST}: it has no authenticated network in front of it. Use a loopback or `
      + "Tailscale (100.64.0.0/10) address, or set ALLOW_WIDE_BIND=1 once your own access controls are in place.",
    );
    process.exit(1);
  }
  // Load (or start building) the map snapshot now, not on the first map request.
  nationalService().current();
  loopbackServer?.listen(PORT, "127.0.0.1", () => {
    console.log(`restaurant-finder UI — http://127.0.0.1:${PORT}`);
  });
  server.listen(PORT, HOST, () => {
    console.log(`restaurant-finder UI — http://${HOST}:${PORT}`);
    if (WIDE_BIND && !isLoopback(HOST) && !isTailnet(HOST)) {
      console.warn(
        `warning: ${HOST} is reachable beyond the tailnet and this app has no authentication of its own. `
        + "List the names it is served under in ALLOWED_HOSTS; other Host headers are rejected.",
      );
    }
  });
}
