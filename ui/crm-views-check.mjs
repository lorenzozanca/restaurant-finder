#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findChromeExecutable } from "../lib/headless-browser.mjs";

// Opens the online app's CRM views (web/: Leads, a venue record, Contacts, Activities,
// and the map's Table link) in headless Chrome as a phone or a desktop, and reports
// timings, rendered row counts, page errors, and screenshots. Run it against a local
// `next dev`/`next start` with AUTH_DEV_EMAIL set and a synced local database:
//   node ui/crm-views-check.mjs --base http://127.0.0.1:3057 [--venue VENUE_ID] [--desktop] [--out output/crm-check]
// --venue should name a venue that has a contact and an activity (the record check
// looks for them).

const argv = process.argv.slice(2);
const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
const base = arg("--base", "http://127.0.0.1:3057");
const venueId = arg("--venue", "");
const desktop = argv.includes("--desktop");
const outDir = resolve(arg("--out", desktop ? "output/crm-check-desktop" : "output/crm-check"));
const DEVICE = desktop ? { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }
  : { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true };
const NETWORK = desktop ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
  : { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };

const executable = findChromeExecutable();
if (!executable) throw new Error("Chrome not found (set CHROME_PATH)");
mkdirSync(outDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "crm-check-"));
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
let session;
const calls = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && calls.has(message.id)) {
    const call = calls.get(message.id);
    calls.delete(message.id);
    if (message.error) call.fail(new Error(message.error.message)); else call.done(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error"
    && !/favicon\.ico/.test(message.params.entry.url || "")) {
    errors.push(`${message.params.entry.text} ${message.params.entry.url || ""}`.trim());
  }
});
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
async function open(path) {
  const started = Date.now();
  await send("Page.navigate", { url: `${base}${path}` });
  return started;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId: session } = await send("Target.attachToTarget", { targetId, flatten: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", DEVICE);
  if (!desktop) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Network.emulateNetworkConditions", NETWORK);

  const rowSelector = desktop ? ".grid-row" : ".card-row";
  const loaded = `document.querySelectorAll('${rowSelector}:not(.loading)').length`;

  // Leads: first rows arrive with the page.
  let started = await open("/leads");
  check("leads: first rows", await waitFor(`${loaded} > 5`), `${Date.now() - started} ms`);
  const count = await evaluate("document.querySelector('.count')?.textContent || ''");
  check("leads: total shown", /156,057 of 156,057/.test(count), count);
  const rendered = await evaluate(`document.querySelectorAll('${rowSelector}').length`);
  check("leads: only rows in view are in the page", rendered > 5 && rendered < 120, `${rendered} rows in the DOM`);
  await shot("leads");

  // Jump deep into the table: the rows there load on their own.
  started = Date.now();
  await evaluate(`(() => { const box = document.querySelector('.grid-wrap'); box.scrollTop = box.scrollHeight * 0.6;
    box.dispatchEvent(new Event('scroll')); })()`);
  const deep = await waitFor(`[...document.querySelectorAll('${rowSelector}:not(.loading)')]
    .some((row) => parseFloat(row.style.top) > document.querySelector('.grid-wrap').scrollHeight * 0.55)`);
  check("leads: rows at 60% of the table load", deep, `${Date.now() - started} ms`);
  await shot("leads-deep");

  // Filters and sort in the URL.
  started = await open("/leads?status=verified&region=05&sort=name&dir=desc");
  await waitFor(`${loaded} > 0`);
  const filtered = await evaluate("document.querySelector('.count')?.textContent || ''");
  check("leads: filtered by URL", /^[\d,]+ of 156,057$/.test(filtered.trim()) && !filtered.startsWith("156,057"), filtered);
  const names = await evaluate(`[...document.querySelectorAll('${rowSelector}:not(.loading) .name')].slice(0, 5).map((n) => n.textContent)`);
  const sortedDesc = names.every((name, k) => k === 0 || name.localeCompare(names[k - 1], "it", { sensitivity: "base" }) <= 0);
  check("leads: sorted by name, descending", names.length > 1 && sortedDesc, names.join(" | "));
  await shot("leads-filtered");

  // The filter panel shows facet counts.
  await evaluate("[...document.querySelectorAll('.toolbar .btn')].find((b) => b.textContent.startsWith('Filters')).click()");
  check("leads: filter panel with counts", await waitFor("document.querySelectorAll('.panel .chip .n').length > 5"));
  await shot("leads-filters");

  if (venueId) {
    started = await open(`/venues/${encodeURIComponent(venueId)}`);
    check("record: loads", await waitFor("!!document.querySelector('.record h1')"), `${Date.now() - started} ms`);
    const text = await evaluate("document.querySelector('.record').innerText");
    check("record: groups", ["SALES", "CONTACTS", "TIMELINE", "IDENTITY", "WEBSITE AND VERIFICATION", "POMOVI DEMO"]
      .every((heading) => text.toUpperCase().includes(heading)));
    check("record: contact and touch shown", /Visit[\s\S]*with/.test(text), text.match(/Visit[^\n]*/)?.[0] || "");
    await shot("record");
    await evaluate("window.scrollTo(0, 0); document.querySelector('.record').scrollTop = 99999");
    await shot("record-bottom");
  }

  started = await open("/contacts");
  check("contacts: rows", await waitFor("document.querySelectorAll('table.plain tbody tr').length > 0"), `${Date.now() - started} ms`);
  await shot("contacts");
  started = await open("/activities");
  check("activities: rows", await waitFor("document.querySelectorAll('table.plain tbody tr').length > 0"), `${Date.now() - started} ms`);
  await shot("activities");

  // The app opens on the table; an old map link keeps its filters.
  await open("/?status=verified");
  check("/ opens the leads table", await waitFor("location.pathname === '/leads' && location.search.includes('status=verified')"),
    await evaluate("location.pathname + location.search"));
  // The map (/map) links to the table with the same filters.
  await open("/map?status=verified&prov=TV");
  check("map: Table link keeps the filters", await waitFor(
    "(() => { const a = document.getElementById('table-btn'); return a && !a.hidden && a.getAttribute('href').includes('prov=TV'); })()"),
  await evaluate("document.getElementById('table-btn')?.getAttribute('href') || ''"));

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" · "));
} finally {
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ base, desktop, results, errors }, null, 2));
  socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(results.every((result) => result.ok) ? 0 : 1);
