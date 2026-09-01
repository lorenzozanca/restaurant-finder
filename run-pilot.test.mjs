import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnrichmentQueue } from "./lib/enrichment-queue.mjs";
import { runPilot } from "./run-pilot.mjs";

test("live pilot fails closed before opening the database when the key is missing", async () => {
  const fixture = pilotFixture();
  await assert.rejects(() => runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "" }),
    /BRAVE_SEARCH_API_KEY is required/);
  assert.equal(sha256(fixture.dbPath), fixture.config.inputs.pilot_database.sha256);
});

test("live pilot meters provider attempts, records evidence atomically, and completes", async () => {
  const fixture = pilotFixture();
  let calls = 0;
  const result = await runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key" }, {
    createProvider: () => ({ name: "brave_web_api", version: "test", async search(request) {
      calls++;
      return { provider: "brave_web_api", http_status: 200, transport_ok: true, parse_ok: true,
        raw_count: 1, rate_headers: {}, results: [{ title: "Test Venue Roma", snippet: "Ristorante",
          url: "https://test-venue.example/", search_engine: "brave_web_api" }] };
    } }),
    enrich: async (venue, location, options) => {
      const response = await options.search(`"${venue.name}" "${location.municipality}" ristorante`, 5);
      return { website: "https://test-venue.example/", website_decision: { status: "accepted" },
        resources: [], resource_decisions: [], enrichment_run: {
          resolver_status: "accepted", resolver_stop_reason: "official_site_accepted",
          search_attempts: [response], resource_search_attempts: [],
        } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.provider_attempts, 1);
  assert.equal(result.stopped, "completed");
  const queue = new EnrichmentQueue(fixture.dbPath);
  assert.equal(queue.status().counts.succeeded, 1);
  assert.equal(queue.db.prepare("SELECT requests_used FROM request_budgets WHERE scope = 'provider'").get().requests_used, 1);
  assert.equal(queue.db.prepare("SELECT COUNT(*) AS count FROM facts WHERE kind = 'website'").get().count, 1);
  assert.equal(queue.getRun(fixture.config.run_id).status, "completed");
  queue.close();
  const resumed = await runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key" });
  assert.equal(resumed.stopped, "completed");
  assert.equal(resumed.provider_attempts, 0);
});

test("live pilot rejects a reviewed-selection fingerprint mismatch before networking", async () => {
  const fixture = pilotFixture();
  fixture.config.inputs.reviewed_selection.sha256 = "0".repeat(64);
  let providerCreated = false;
  await assert.rejects(() => runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key" }, {
    createProvider: () => { providerCreated = true; return {}; },
  }), /reviewed selection SHA-256 mismatch/);
  assert.equal(providerCreated, false);
});

test("accepts only the pinned fresh 120-request allowance", async () => {
  const fixture = pilotFixture();
  fixture.config.authorization.allowance_id = "session-10-fresh-pilot-2026-09-01";
  fixture.config.request_budget = { combined_ceiling: 120, reserve: 780, period: "fresh-test" };
  const result = await runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "test" }, {
    createProvider: () => ({ name: "brave_web_api", version: "test", async search() {
      return { provider: "brave_web_api", http_status: 200, transport_ok: true, parse_ok: true,
        raw_count: 0, rate_headers: {}, results: [] };
    } }),
    enrich: async () => ({ website: null, resources: [] }),
  });
  assert.equal(result.stopped, "completed");
});

test("historical completed allowances are rejected before provider creation", async () => {
  const fixture = pilotFixture();
  delete fixture.config.authorization.status;
  let providerCreated = false;
  await assert.rejects(() => runPilot({
    dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key",
  }, {
    createProvider: () => { providerCreated = true; return {}; },
  }), /allowance is not active/);
  assert.equal(providerCreated, false);
});

test("provider unavailability requeues the job and stops without recording success", async () => {
  const fixture = pilotFixture();
  const result = await runPilot({
    dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key",
  }, {
    createProvider: () => ({ name: "brave_web_api", version: "test", async search() {
      throw new Error("provider should not be called by this fixture");
    } }),
    enrich: async () => ({ resources: [], enrichment_run: { search_attempts: [{
      outcome: "provider_failed", provider: "brave_web_api", attempts: [{
        provider: "brave_web_api", transport_ok: false, parse_ok: false,
        reason: "transport_error",
      }],
    }] } }),
  });
  assert.equal(result.stopped, "quota_paused");
  const queue = new EnrichmentQueue(fixture.dbPath);
  assert.equal(queue.status().counts.queued, 1);
  assert.equal(queue.status().counts.succeeded ?? 0, 0);
  assert.equal(queue.db.prepare("SELECT COUNT(*) AS count FROM enrichment_attempts").get().count, 0);
  assert.equal(queue.status().quota_pauses[0].reason, "provider_unavailable");
  queue.close();
});

test("warm execution is blocked until cold output is explicitly adjudicated as passing", async () => {
  const fixture = pilotFixture();
  fixture.config.scenario = "warm_incremental";
  fixture.config.prior_run_id = "cold-run";
  await assert.rejects(() => runPilot({
    dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key",
  }), /cold-output adjudication gate/);
});

test("warm pilot replays completed jobs while preserving the shared request budget", async () => {
  const fixture = pilotFixture();
  let calls = 0;
  const dependencies = {
    createProvider: () => ({ name: "brave_web_api", version: "test", async search() {
      calls++;
      return { provider: "brave_web_api", http_status: 200, transport_ok: true, parse_ok: true,
        raw_count: 0, rate_headers: {}, results: [] };
    } }),
    enrich: async (_venue, _location, options) => {
      const response = await options.search('test query', 5);
      return { resources: [], resource_decisions: [], enrichment_run: {
        resolver_status: "not_found", resolver_stop_reason: "search_exhausted",
        search_attempts: [response], resource_search_attempts: [],
      } };
    },
  };
  await runPilot({ dbPath: fixture.dbPath, config: fixture.config, apiKey: "test-key" }, dependencies);
  const warm = structuredClone(fixture.config);
  warm.run_id = "test-live-pilot-warm";
  warm.scenario = "warm_incremental";
  warm.prior_run_id = fixture.config.run_id;
  warm.authorization.cold_output_adjudicated = true;
  warm.authorization.cold_quality_decision = "pass";
  warm.inputs.pilot_database.sha256 = sha256(fixture.dbPath);
  const result = await runPilot({ dbPath: fixture.dbPath, config: warm, apiKey: "test-key" }, dependencies);
  assert.equal(result.stopped, "completed");
  assert.equal(calls, 2);
  const queue = new EnrichmentQueue(fixture.dbPath);
  assert.equal(queue.getRun(warm.run_id).status, "completed");
  assert.equal(queue.db.prepare("SELECT requests_used FROM request_budgets WHERE scope = 'provider'").get().requests_used, 2);
  queue.close();
});

function pilotFixture() {
  const directory = mkdtempSync(join(tmpdir(), "restaurant-finder-live-pilot-"));
  const selectionPath = join(directory, "selection.json");
  const dbPath = join(directory, "pilot.sqlite");
  writeFileSync(selectionPath, JSON.stringify({ reviewed: true, candidates: [] }));
  const queue = new EnrichmentQueue(dbPath);
  queue.enqueue({
    venue: { canonical_venue_id: "venue:test", name: "Test Venue", website: null,
      source_records: [{ source_record_id: "source:test", source: "fixture", name: "Test Venue",
        municipality: "Roma", province_code: "RM", postcode: "00100" }] },
    municipality: "Roma", provider: "", maxAttempts: 2,
    payload: { municipality: "Roma", known_website: null },
  });
  queue.close();
  const config = {
    schema_version: 1, run_id: "test-live-pilot", scenario: "cold",
    code_version: "test", scoring_version: "test",
    inputs: { reviewed_selection: { path: selectionPath, sha256: sha256(selectionPath) },
      pilot_database: { path: dbPath, sha256: sha256(dbPath), expected_jobs: 1 },
      evidence_store: { path: dbPath } },
    request_budget: { combined_ceiling: 72, reserve: 25, period: "test-live-pilot" },
    resolver: { searches_per_venue: 3, crawls_per_venue: 3,
      budget_escalation_reason: "labelled_high_confidence_venue" },
    worker: { concurrency: 2, per_domain_concurrency: 1 },
    provider: { name: "brave_web_api", concurrency: 1, requests_per_second: 1, max_retries: 1 },
    cache: { search_directory: join(directory, "cache"), http_directory: join(directory, "http-cache") },
    authorization: { live_pilot: true, status: "active", national_queue: false, publication: false },
  };
  return { directory, selectionPath, dbPath, config };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
