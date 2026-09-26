#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findChromeExecutable } from "../lib/headless-browser.mjs";

// Opens the national lead map in headless Chrome as a phone (Pixel 7 viewport, touch,
// throttled 4G), drives the main interactions, and reports timings, bytes
// transferred, and screenshots. Usage (with the map server running):
//   node ui/map-mobile-check.mjs [--url http://127.0.0.1:4188/map.html] [--out output/map-check] [--desktop]
// --desktop checks the wide layout (side panel, mouse, no throttling) instead.

const argv = process.argv.slice(2);
const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const pageUrl = arg("--url", "http://127.0.0.1:4188/map.html");
const outDir = resolve(arg("--out", "output/map-check"));
const desktop = argv.includes("--desktop");
const DEVICE = desktop ? { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }
  : { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true };
// Conservative mobile 4G: 150 ms round trip, 9 Mbit/s down, 1.5 Mbit/s up.
const NETWORK = desktop ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
  : { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };

const executable = findChromeExecutable();
if (!executable) throw new Error("Chrome not found (set CHROME_PATH)");
mkdirSync(outDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "map-check-"));
const chrome = spawn(executable, ["--headless=new", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
{ stdio: ["ignore", "ignore", "pipe"] });
const endpoint = await new Promise((done, fail) => {
  let text = "";
  chrome.stderr.on("data", (chunk) => {
    text += chunk;
    const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) done(match[1]);
  });
  setTimeout(() => fail(new Error("Chrome did not start")), 20_000);
});

const socket = new WebSocket(endpoint);
await new Promise((done) => socket.addEventListener("open", done));
let nextId = 1;
const calls = new Map();
const listeners = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && calls.has(message.id)) {
    const call = calls.get(message.id);
    calls.delete(message.id);
    if (message.error) call.fail(new Error(message.error.message)); else call.done(message.result);
  } else for (const listener of listeners) listener(message);
});
let session;
const send = (method, params = {}) => new Promise((done, fail) => {
  const id = nextId++;
  calls.set(id, { done, fail });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expression, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(expression)) return true;
    await sleep(100);
  }
  return false;
}
async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
}
async function tap(x, y) {
  if (desktop) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
    return;
  }
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
session = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
const bytes = { api: 0, tiles: 0, vendor: 0, page: 0, osm: 0 };
const requests = new Map();
listeners.push((message) => {
  if (message.sessionId !== session) return;
  if (message.method === "Network.requestWillBeSent") requests.set(message.params.requestId, message.params.request.url);
  if (message.method === "Network.loadingFinished") {
    const url = requests.get(message.params.requestId) || "";
    const size = message.params.encodedDataLength;
    if (url.includes("/api/national/tile/")) bytes.tiles += size;
    else if (url.includes("/api/")) bytes.api += size;
    else if (url.includes("/vendor/")) bytes.vendor += size;
    else if (url.includes("openstreetmap")) bytes.osm += size;
    else bytes.page += size;
  }
});
await send("Network.enable");
await send("Page.enable");
await send("Network.emulateNetworkConditions", NETWORK);
await send("Emulation.setDeviceMetricsOverride", DEVICE);
if (!desktop) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
if (!desktop) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Mobile Safari/537.36 restaurant-finder-map-check" });

const report = { device: DEVICE, network: NETWORK, timings_ms: {}, checks: {} };
const started = Date.now();
await send("Page.navigate", { url: pageUrl });
const leadCanvases = "document.querySelectorAll('.leaflet-tile-container canvas').length";
report.checks.clusters_drawn = await waitFor(`${leadCanvases} > 0 && /in view/.test(document.getElementById('head-text').textContent)`);
report.timings_ms.first_clusters_and_counts = Date.now() - started;
await sleep(1500);
await shot("1-italy");
report.checks.head_text = await evaluate("document.getElementById('head-text').innerText");
report.bytes_initial = { ...bytes };

// Tap the biggest bubble on screen: the map must zoom in to its expansion zoom.
const target = await evaluate(`(() => {
  const { map, tileData } = window.leadMap; const z = map.getZoom(); let best = null;
  const box = map.getContainer().getBoundingClientRect();
  tileData.forEach((data, key) => {
    const [tx, ty, tz] = key.split(':').map(Number); if (tz !== z) return;
    for (let k = 0; k < data.c.length; k += 5) {
      const point = map.latLngToContainerPoint(map.unproject([tx * 512 + data.c[k], ty * 512 + data.c[k + 1]], z));
      const x = point.x + box.left, y = point.y + box.top;
      if (x < box.left + 30 || x > innerWidth - 30 || y < 140 || y > innerHeight - 140) continue;
      if (!best || data.c[k + 2] > best.count) best = { x, y, count: data.c[k + 2], expand: data.c[k + 4] };
    }
  });
  return best ? { ...best, zoom: z } : null; })()`);
report.checks.bubble_tapped = target;
if (target) {
  await tap(target.x, target.y);
  await sleep(2500);
  report.checks.tap_zoomed_to = await evaluate("window.leadMap.map.getZoom()");
}

// Search a town the way a person does: tap the box, type letter by letter, and tap
// the suggestion. Every keystroke must answer quickly with a short suggestion list.
const box = await evaluate("(() => { const r = document.getElementById('q').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; })()");
await tap(box.x, box.y);
await waitFor("document.activeElement === document.getElementById('q')", 5_000);
await sleep(1000); // the town list loads on focus
report.timings_ms.keystrokes = [];
for (const letter of "trev") {
  const typed = Date.now();
  await send("Input.insertText", { text: letter });
  await evaluate("new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))");
  report.timings_ms.keystrokes.push(Date.now() - typed);
}
report.checks.suggestion_rows = await evaluate("document.querySelectorAll('#suggest li').length");
report.checks.suggestion_first = await evaluate("document.querySelector('#suggest li')?.textContent || null");
await shot("2a-suggestions");
let t = Date.now();
const row = await evaluate(`(() => { const li = [...document.querySelectorAll('#suggest li')].find((el) => /^Treviso/.test(el.textContent));
  if (!li) return null; const r = li.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
report.checks.suggestion_found = Boolean(row);
if (row) await tap(row.x, row.y);
report.checks.search_to_town = await waitFor("/,1[1-6]z$/.test(location.hash) && document.getElementById('q').value === 'Treviso (TV)' && document.getElementById('suggest').hidden", 10_000);
await sleep(2500);
report.timings_ms.search_to_town = Date.now() - t;
await shot("2-treviso");

// Open the list (half sheet).
t = Date.now();
await evaluate("document.querySelector('.tab[data-view=list]').click()");
report.checks.list_loaded = await waitFor("document.querySelectorAll('#list-items .item').length > 0", 10_000);
report.timings_ms.list = Date.now() - t;
await sleep(500);
await shot("3-list");

// Open the first venue.
t = Date.now();
await evaluate("document.querySelector('#list-items .item').click()");
report.checks.venue_opened = await waitFor("!document.getElementById('venue').hidden && document.querySelector('#venue h2')", 10_000);
report.timings_ms.venue = Date.now() - t;
await sleep(1500);
await shot("4-venue");

// Review an undecided venue: the card explains its status and opens the decision
// form. Nothing is submitted, so the check never writes to the national store.
t = Date.now();
const reviewName = await evaluate("fetch('/api/national/list?status=unresolved&limit=1').then((r) => r.json()).then((d) => { window.leadMap.openVenue(d.items[0].i, false); return d.items[0].name; })");
report.checks.review_details = await waitFor(`document.querySelector('#venue h2')?.textContent === ${JSON.stringify(reviewName)}
  && /Why this status/.test(document.getElementById('review')?.textContent || '') && !!document.getElementById('r-open')`, 10_000);
report.timings_ms.review_details = Date.now() - t;
report.checks.review_text = await evaluate("document.getElementById('review').innerText.slice(0, 300)");
await evaluate("document.getElementById('r-open').click()");
await sleep(800);
report.checks.review_form_open = await evaluate("!document.getElementById('r-form').hidden && document.getElementById('r-site').value");
await shot("4b-review");
report.checks.old_pages_redirect = await evaluate("Promise.all(['/', '/review.html'].map((path) => fetch(path).then((r) => new URL(r.url).pathname))).then((paths) => paths.every((path) => path === '/map.html'))");

// Filters: verified websites in Veneto.
await evaluate("document.querySelector('.tab[data-view=filters]').click(); document.getElementById('sheet').dataset.state = 'full'");
await sleep(600);
await shot("5-filters");
t = Date.now();
await evaluate(`(() => {
  const region = document.getElementById('f-region'); region.value = '05'; region.dispatchEvent(new Event('change'));
  [...document.querySelectorAll('#f-status .chip')].find((c) => /Verified/.test(c.textContent)).click();
})()`);
await evaluate("document.getElementById('sheet').dataset.state = 'peek'");
report.checks.filtered = await waitFor("/status=verified/.test(location.search) && /region=05/.test(location.search)", 5_000);
await sleep(3500);
report.timings_ms.filter_apply = Date.now() - t;
report.checks.filtered_head = await evaluate("document.getElementById('head-text').innerText");
await shot("6-veneto-verified");

// Zoom far in on Venice: individual venue dots.
await evaluate("history.replaceState(null, '', location.pathname + '#@45.4375,12.3358,17z'); location.reload()");
await sleep(500);
report.checks.street_level = await waitFor(`${leadCanvases} > 0`, 20_000);
await sleep(3000);
await shot("7-venice-street");

report.bytes_total = bytes;
report.total_ms = Date.now() - started;
writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const exited = new Promise((done) => chrome.once("exit", done));
chrome.kill("SIGKILL");
await exited;
await rm(profile, { recursive: true, force: true });
process.exit(0);
