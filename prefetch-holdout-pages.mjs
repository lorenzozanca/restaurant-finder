#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { get } from "./lib/lib.mjs";
import { createHeadlessRenderer } from "./lib/headless-browser.mjs";
import { crawlWebsiteCandidate } from "./find-menu.mjs";
import { registrableDomain } from "./lib/publisher-ownership.mjs";

// Zero-LLM prefetch for holdout labelling (PROCESS.md step 3.3): crawls each packet's
// candidate and one contact-like page, and keeps only short identity excerpts (name,
// street, postcode, phone, VAT lines) so a labelling agent reads ~2 KB per venue
// instead of raw pages. Output stays under data/ (gitignored; page text is not kept).

const CONTACT = /contatt|contact|dove-siamo|dovesiamo|chi-siamo|chisiamo|about|info|where/i;
const STOP = new Set(["ristorante", "pizzeria", "trattoria", "osteria", "bar", "caffe", "cafe", "hotel",
  "della", "delle", "dello", "degli", "dei", "del", "via", "piazza", "viale", "corso", "the"]);

export function identityExcerpt(text, venue, limit = 1500) {
  const clean = String(text || "").replace(/[ \t]+/g, " ");
  const chunks = clean.split(/\n+|(?<=[.;|•])\s+/).map((chunk) => chunk.trim()).filter(Boolean);
  const words = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word));
  const terms = new Set([...words(venue.name), ...venue.aliases.flatMap(words), ...words(venue.municipality),
    ...words(String(venue.address).split(",")[0])]);
  const phone = String(venue.phone || "").replace(/\D/g, "").slice(-7);
  const matches = (chunk) => {
    const lower = chunk.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return [...terms].some((term) => lower.includes(term))
      || (venue.postcode && chunk.includes(venue.postcode))
      || (phone.length === 7 && chunk.replace(/\D/g, "").includes(phone))
      || /p\.?\s?iva|partita iva|vat|c\.f\./i.test(chunk);
  };
  const kept = [clean.slice(0, 250)];
  let size = kept[0].length;
  for (const chunk of chunks) {
    if (size >= limit) break;
    if (!matches(chunk)) continue;
    const piece = chunk.slice(0, 220);
    if (kept.some((item) => item.includes(piece))) continue;
    kept.push(piece);
    size += piece.length;
  }
  return kept.join(" | ").slice(0, limit);
}

async function prefetchVenue(venue, crawl) {
  const result = { venue_id: venue.venue_id, candidate_url: venue.candidate_url };
  let home;
  try { home = await crawl(venue.candidate_url); } catch (error) { home = { status: "failed",
    failure_reason: String(error.message || error).slice(0, 100) }; }
  Object.assign(result, { crawl_status: home.status, failure_reason: home.failure_reason || null,
    http_status: home.http_status || null, final_url: home.final_url || null, rendered: Boolean(home.rendered),
    home_excerpt: home.status === "succeeded" ? identityExcerpt(home.site_facts?.visible_text, venue) : "" });
  if (home.status !== "succeeded") return result;
  const domain = registrableDomain(home.final_url || venue.candidate_url);
  const contact = (home.resources || []).find((item) => item.url && registrableDomain(item.url) === domain
    && CONTACT.test(`${item.url} ${item.label || ""}`));
  if (!contact) return result;
  try {
    const page = await crawl(contact.url);
    if (page.status === "succeeded") {
      result.contact_url = page.final_url || contact.url;
      result.contact_excerpt = identityExcerpt(page.site_facts?.visible_text, venue, 1000);
    }
  } catch { /* the contact page is optional */ }
  return result;
}

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const argv = process.argv.slice(2);
  const arg = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const packetDir = resolve(arg("--packet-dir", "benchmark/llm-review-holdout-v1/labelling"));
  const outputDir = resolve(arg("--output-dir", "data/holdout-labelling"));
  const only = arg("--packet", null);
  const cacheDir = join(outputDir, "cache");
  mkdirSync(outputDir, { recursive: true });
  const renderer = argv.includes("--no-headless") ? null : createHeadlessRenderer({ concurrency: 3 });
  const headers = { "User-Agent": "Mozilla/5.0 restaurant-finder holdout labelling prefetch" };
  const crawl = (url) => crawlWebsiteCandidate(url, {
    get: (target, options) => get(target, { ...options, cacheDir, headers }),
    getRendered: renderer?.available ? (target, options) => renderer.render(target, options)
      : (target, options) => get(target, { ...options, cacheDir, headers }),
    timeout: 20_000, renderedTimeout: 20_000, maxBytes: 256_000 });
  try {
    for (const name of readdirSync(packetDir).sort().filter((file) => /^packet-\d{3}-\d{3}\.json$/.test(file))) {
      if (only && !name.includes(only)) continue;
      const packet = JSON.parse(readFileSync(join(packetDir, name), "utf8"));
      const venues = await mapLimit(packet.venues, 6, (venue) => prefetchVenue(venue, crawl));
      const output = join(outputDir, name.replace("packet-", "pages-"));
      writeFileSync(output, `${JSON.stringify({ packet: packet.packet, fetched_at: new Date().toISOString(),
        venues }, null, 1)}\n`);
      const ok = venues.filter((venue) => venue.crawl_status === "succeeded").length;
      process.stdout.write(`${name}: ${ok}/${venues.length} fetched, ` +
        `${venues.filter((venue) => venue.contact_excerpt).length} contact pages -> ${output}\n`);
    }
  } finally { await renderer?.close(); }
}
