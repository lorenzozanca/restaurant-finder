#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { EvidenceStore } from "./lib/evidence-store.mjs";
import { get } from "./lib/lib.mjs";
import { cacheGet, cacheSet } from "./lib/cache.mjs";
import { createHeadlessRenderer } from "./lib/headless-browser.mjs";
import { classifyWebsite, crawlWebsiteCandidate, scoreOfficialWebsite } from "./find-menu.mjs";
import { validateWebFixtureDocument } from "./lib/web-stress-fixture.mjs";

const DEFAULT_CONCURRENCY = 8;

export async function assessLabelledCorpus(options, dependencies = {}) {
  const partition = required(options.partition, "partition");
  if (!['development', 'locked_holdout'].includes(partition)) throw new Error("invalid partition");
  const fixtureDirectories = (options.fixtureDirectories || []).map((directory) => resolve(directory));
  if (!fixtureDirectories.length) throw new Error("at least one fixture directory is required");
  const dbPath = resolve(required(options.dbPath, "db"));
  const cacheDir = resolve(required(options.cacheDir, "cache-dir"));
  const concurrency = boundedInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 32, "concurrency");
  const timeout = boundedInteger(options.timeout, 20_000, 1_000, 60_000, "timeout");
  const retryStates = new Set(options.retryStates || []);
  const fixtures = loadFixtures(fixtureDirectories, partition);
  const entries = fixtures.flatMap((document) => document.entries);
  const targetEvidence = options.venueDbPath
    ? loadTargetEvidence(resolve(options.venueDbPath), entries) : new Map();
  const units = entries.flatMap((entry) => entry.candidates.map((candidate) => ({ entry, candidate })));
  const store = new EvidenceStore(dbPath);
  const browserHeaders = { "User-Agent": "Mozilla/5.0 restaurant-finder candidate assessor" };
  const renderer = dependencies.crawl || options.headless === false ? null
    : createHeadlessRenderer({ concurrency: Math.min(4, concurrency) });
  const crawl = dependencies.crawl || ((url) => crawlWebsiteCandidate(url, {
    get: (target, requestOptions) => get(target, { ...requestOptions, cacheDir,
      headers: browserHeaders }),
    getRendered: renderer?.available
      ? (target, requestOptions) => renderCached(renderer, target, requestOptions, cacheDir)
      : (target, requestOptions) => get(target, { ...requestOptions, cacheDir,
        headers: browserHeaders }),
    timeout,
    renderedTimeout: timeout,
    maxBytes: 256_000,
  }));
  let completed = 0;
  let skipped = 0;
  try {
    for (const entry of entries) rememberFixtureVenue(store, entry, targetEvidence.get(entry.venue_id));
    const existing = new Map(store.listCandidateAssessments({ limit: 500 })
      .map((row) => [key(row), row.assessment_state]));
    // A labelled corpus can exceed the public list API's bounded page size.
    for (const row of store.db.prepare(`SELECT venue_id, candidate_url, assessment_state
        FROM candidate_assessments`).all()) {
      existing.set(key(row), row.assessment_state);
    }
    const pending = units.filter(({ entry, candidate }) => {
      const state = existing.get(key({ venue_id: entry.venue_id, candidate_url: canonicalUrl(candidate.url) }));
      if (state && !retryStates.has(state)) {
        skipped++;
        return false;
      }
      return true;
    });
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (cursor < pending.length) {
        const unit = pending[cursor++];
        await assessOne(store, unit, crawl, dependencies.clock, targetEvidence.get(unit.entry.venue_id));
        completed++;
        if (dependencies.onProgress) dependencies.onProgress({ completed, pending: pending.length });
        else if (completed % 25 === 0 || completed === pending.length) {
          process.stdout.write(`assessed ${completed}/${pending.length}\n`);
        }
      }
    });
    await Promise.all(workers);
    return {
      partition, fixture_documents: fixtures.length, venues: entries.length,
      candidates: units.length, assessed_now: completed, resumed_existing: skipped,
      database: dbPath, cache_directory: cacheDir,
      assessment_counts: store.candidateAssessmentCounts(),
    };
  } finally {
    store.close();
    await renderer?.close();
  }
}

async function renderCached(renderer, url, requestOptions, cacheDir) {
  const cacheKey = `rendered:v1:${requestOptions.maxBytes}:${url}`;
  const cached = await cacheGet(cacheKey, { cacheDir });
  if (cached !== null) return cached;
  const result = await renderer.render(url, requestOptions);
  if (result.ok) await cacheSet(cacheKey, result, { cacheDir });
  return result;
}

async function assessOne(store, { entry, candidate }, crawl, clock, target = {}) {
  let crawlResult = { status: "not_crawled", final_url: candidate.url, resources: [], site_facts: {} };
  if (classifyWebsite(candidate.url) === "official") {
    try { crawlResult = await crawl(candidate.url); }
    catch (error) { crawlResult = { status: "failed", final_url: candidate.url,
      resources: [], site_facts: {}, error: error?.message || "crawl_failed" }; }
  }
  const decision = scoreOfficialWebsite({
    url: candidate.url, title: candidate.title, crawl: crawlResult, known: false,
  }, {
    name: target.name || entry.name, aliases: [...new Set([target.name || entry.name,
      ...(target.aliases || [])].filter(Boolean))],
    address: target.address || entry.address || "", phone: target.phone || "",
  }, {
    municipality: target.municipality || entry.municipality,
    region: target.region || entry.region || "", country_code: "IT",
    postcodes: target.postcode ? [target.postcode] : [],
  });
  store.recordCandidateAssessment(entry.venue_id, {
    candidate_url: candidate.url,
    final_url: decision.final_url || decision.url || crawlResult.final_url || candidate.url,
    assessment_state: decision.assessment_state,
    crawl_outcome: crawlResult.status || "failed",
    scores: decision.scores,
    evidence: decision.reasons,
    candidate_origin: "labelled_fixture",
  }, { checkedAt: clock ? clock() : new Date() });
}

function loadTargetEvidence(path, entries) {
  if (!existsSync(path)) throw new Error(`venue database not found: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const wanted = new Set(entries.map((entry) => entry.venue_id));
    const venues = new Map();
    for (const row of db.prepare(`SELECT venue_id, display_name, municipality FROM venues
        WHERE lifecycle_status = 'active'`).iterate()) {
      if (wanted.has(row.venue_id)) venues.set(row.venue_id, row);
    }
    const sourcesByVenue = new Map();
    for (const row of db.prepare(`SELECT venue_id, payload_json FROM source_records
        ORDER BY source_record_id`).iterate()) {
      if (!wanted.has(row.venue_id)) continue;
      if (!sourcesByVenue.has(row.venue_id)) sourcesByVenue.set(row.venue_id, []);
      sourcesByVenue.get(row.venue_id).push(parseJson(row.payload_json));
    }
    const aliasesByVenue = new Map();
    for (const row of db.prepare("SELECT venue_id, alias FROM venue_aliases ORDER BY alias").iterate()) {
      if (!wanted.has(row.venue_id)) continue;
      if (!aliasesByVenue.has(row.venue_id)) aliasesByVenue.set(row.venue_id, []);
      aliasesByVenue.get(row.venue_id).push(row.alias);
    }
    return new Map(entries.map((entry) => {
      const sources = sourcesByVenue.get(entry.venue_id) || [];
      const preferred = sources.find((source) => source.phone || source.address) || sources[0] || {};
      const venue = venues.get(entry.venue_id) || {};
      return [entry.venue_id, {
        name: venue.display_name || entry.name,
        municipality: preferred.municipality || venue.municipality || entry.municipality,
        region: preferred.region || preferred.region_code || entry.region || "",
        phone: preferred.phone || "", address: preferred.address || entry.address || "",
        postcode: preferred.postcode || preferred.address_components?.postcode
          || preferred.address_components?.postal_code || "",
        aliases: aliasesByVenue.get(entry.venue_id) || [],
      }];
    }));
  } finally { db.close(); }
}

function loadFixtures(directories, partition) {
  const pattern = partition === "development"
    ? /^development-\d{3}-\d{3}\.json$/ : /^locked-holdout-\d{3}-\d{3}\.json$/;
  const documents = directories.flatMap((directory) => readdirSync(directory).sort()
    .filter((name) => pattern.test(name))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), "utf8"))));
  if (!documents.length) throw new Error(`no ${partition} fixture documents found`);
  for (const document of documents) {
    validateWebFixtureDocument(document, { expectedPartition: partition });
    if (document.entries.some((entry) => entry.partition !== undefined
        && entry.partition !== partition)) {
      throw new Error("fixture entry partition mismatch");
    }
  }
  const venueIds = documents.flatMap((document) => document.entries.map((entry) => entry.venue_id));
  if (new Set(venueIds).size !== venueIds.length) throw new Error("duplicate fixture venue");
  return documents;
}

function rememberFixtureVenue(store, entry, target = {}) {
  const name = target.name || entry.name;
  const municipality = target.municipality || entry.municipality || "";
  store.rememberVenue({
    canonical_venue_id: entry.venue_id, name, aliases: [name, ...(target.aliases || [])].filter(Boolean),
    source_records: [{ source_record_id: `labelled-fixture:${entry.venue_id}`,
      source: "labelled_fixture", name, address: target.address || entry.address || "",
      municipality, region: target.region || entry.region || "" }],
  }, { municipality });
}
function key(value) { return `${value.venue_id}\n${canonicalUrl(value.candidate_url)}`; }
function canonicalUrl(value) { try { return new URL(value).href; } catch { return String(value || ""); } }
function required(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} is required`); return text; }
function boundedInteger(value, fallback, minimum, maximum, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function parseArgs(argv) {
  const result = { fixtureDirectories: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--fixture-dir") result.fixtureDirectories.push(argv[++index]);
    else if (flag === "--partition") result.partition = argv[++index];
    else if (flag === "--db") result.dbPath = argv[++index];
    else if (flag === "--cache-dir") result.cacheDir = argv[++index];
    else if (flag === "--venue-db") result.venueDbPath = argv[++index];
    else if (flag === "--concurrency") result.concurrency = argv[++index];
    else if (flag === "--timeout") result.timeout = argv[++index];
    else if (flag === "--no-headless") result.headless = false;
    else if (flag === "--retry-state") (result.retryStates ||= []).push(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  return result;
}

function parseJson(value) { try { return JSON.parse(value); } catch { return {}; } }

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  assessLabelledCorpus(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { console.error(`assess-labelled-corpus: ${error.message}`); process.exitCode = 1; });
}
