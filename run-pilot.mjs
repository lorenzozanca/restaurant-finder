#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { EnrichmentQueue, runEnrichmentWorker } from "./lib/enrichment-queue.mjs";
import { findMenuSources } from "./find-menu.mjs";
import { searchDetailed } from "./lib/search.mjs";
import { createScheduledSearchProvider } from "./lib/provider-scheduler.mjs";
import { createBraveWebApiProvider } from "./sources/search/brave-web-api.mjs";

export async function runPilot(input, dependencies = {}) {
  const config = validateConfig(input.config);
  const dbPath = resolve(input.dbPath);
  verifySha256(resolve(config.inputs.reviewed_selection.path), config.inputs.reviewed_selection.sha256,
    "reviewed selection");
  const actualDatabaseSha256 = sha256(dbPath);
  const pristineDatabase = actualDatabaseSha256 === config.inputs.pilot_database.sha256;
  const apiKey = input.apiKey || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is required before the live pilot can start");

  const queue = new EnrichmentQueue(dbPath);
  const providerContext = new AsyncLocalStorage();
  let providerHalted = false;
  let providerAttempts = 0;
  try {
    assertPilotQueue(queue, config);
    let run = queue.getRun(config.run_id);
    if (!pristineDatabase && !isAuthorizedResume(run, config)) {
      throw new Error(`pilot database SHA-256 mismatch: expected ${config.inputs.pilot_database.sha256}, got ${actualDatabaseSha256}`);
    }
    if (!run) {
      if (config.scenario === "warm_incremental") assertWarmPrecondition(queue, config);
      run = queue.createRun({ runId: config.run_id, codeVersion: config.code_version,
        scoringVersion: config.scoring_version, configuration: config });
      if (config.scenario === "warm_incremental") {
        const now = new Date().toISOString();
        queue.db.prepare(`UPDATE enrichment_jobs SET run_id = ?, status = 'queued', result_json = NULL,
          next_attempt_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
          last_error = NULL, finished_at = NULL, updated_at = ?
          WHERE run_id = ? AND status = 'succeeded'`)
          .run(config.run_id, now, now, config.prior_run_id);
      } else {
        const foreign = queue.db.prepare(`SELECT COUNT(*) AS count FROM enrichment_jobs
          WHERE run_id IS NOT NULL AND run_id <> ?`).get(config.run_id).count;
        if (foreign) throw new Error("pilot database contains jobs assigned to another run");
        queue.db.prepare("UPDATE enrichment_jobs SET run_id = ? WHERE run_id IS NULL").run(config.run_id);
      }
    } else if (run.status !== "running") {
      return { run, queue: queue.status(), provider_attempts: 0, stopped: run.status };
    }

    for (const scope of ["global", "provider"]) {
      queue.configureBudget(scope, scope === "global" ? "all" : config.provider.name,
        config.request_budget.combined_ceiling, { period: config.request_budget.period });
    }

    const rawProvider = (dependencies.createProvider || createBraveWebApiProvider)({ apiKey });
    const budgetedProvider = {
      name: config.provider.name,
      version: rawProvider.version,
      endpointVersion: rawProvider.endpointVersion,
      async search(request) {
        const context = providerContext.getStore();
        if (!context) throw new Error("provider request has no queue budget context");
        if (providerHalted) return quotaAttempt(config.provider.name, "budget_exhausted");
        try {
          context.reserveRequests(1, [{ scope: "provider", key: config.provider.name }],
            { period: config.request_budget.period });
        } catch (error) {
          if (error?.code !== "REQUEST_BUDGET_EXHAUSTED") throw error;
          providerHalted = true;
          return quotaAttempt(config.provider.name, "budget_exhausted");
        }
        providerAttempts++;
        const response = await rawProvider.search(request);
        const limited = response?.http_status === 429 || response?.reason === "rate_limited";
        if (limited) providerHalted = true;
        context.recordProviderOutcome({ ok: response?.transport_ok === true
          && response?.parse_ok === true && !limited });
        return response;
      },
    };
    const provider = createScheduledSearchProvider(budgetedProvider, {
      requestsPerSecond: config.provider.requests_per_second,
      maxConcurrency: config.provider.concurrency,
      maxRetries: config.provider.max_retries,
      maxAttempts: config.request_budget.combined_ceiling,
    });

    const handler = async (job, context) => {
      const venue = loadVenue(queue, job);
      const location = { municipality: venue.municipality,
        province_code: venue.province_code || "", postcodes: venue.postcode ? [venue.postcode] : [] };
      const search = (query, limit, options = {}) => providerContext.run(context, () => searchDetailed({
        query, limit, purpose: options.purpose || "official_site",
        required_domain: options.required_domain, location,
        identity: { aliases: [venue.name, ...(venue.aliases || [])].filter(Boolean) },
      }, { providers: [provider], cacheDir: resolve(config.cache.search_directory) }));
      return (dependencies.enrich || findMenuSources)(venue, location, {
        search, resolverBudget: { searches: config.resolver.searches_per_venue,
          crawls: config.resolver.crawls_per_venue,
          budget_escalation_reason: config.resolver.budget_escalation_reason },
      });
    };
    const workerOptions = {
      stopWhenIdle: true,
      maxConcurrency: config.worker.concurrency,
      maxProviderConcurrency: config.provider.concurrency,
      maxDomainConcurrency: config.worker.per_domain_concurrency,
      applyResult: (result, job, store) => {
        const venue = loadVenue(queue, job);
        store.recordEnrichment(venue, result, { municipality: venue.municipality });
      },
    };
    const workers = Array.from({ length: config.worker.concurrency }, (_, index) =>
      runEnrichmentWorker(queue, `${config.run_id}:worker-${index + 1}`, handler, workerOptions));
    const workerResults = await Promise.all(workers);
    const status = queue.status();
    const quotaPaused = workerResults.some((item) => item.stopped === "quota_paused")
      || status.quota_pauses.length > 0;
    if (!status.active) {
      run = queue.finishRun(config.run_id, { status: status.dead_letters ? "failed" : "completed",
        sourceHealth: provider.health() });
    } else {
      run = queue.getRun(config.run_id);
    }
    return { run, queue: status, workers: workerResults, provider_attempts: providerAttempts,
      stopped: quotaPaused ? "quota_paused" : status.active ? "incomplete" : run.status };
  } finally {
    queue.close();
  }
}

function loadVenue(queue, job) {
  const row = queue.db.prepare("SELECT * FROM venues WHERE venue_id = ?").get(job.venue_id);
  if (!row) throw new Error(`venue missing for job ${job.job_id}`);
  const records = queue.db.prepare(`SELECT payload_json FROM source_records
    WHERE venue_id = ? ORDER BY source_record_id`).all(job.venue_id)
    .map((item) => JSON.parse(item.payload_json));
  if (!records.length) throw new Error(`source records missing for job ${job.job_id}`);
  const aliases = queue.db.prepare("SELECT alias FROM venue_aliases WHERE venue_id = ? ORDER BY alias")
    .all(job.venue_id).map((item) => item.alias);
  const primary = records[0];
  return { ...primary, canonical_venue_id: job.venue_id, name: row.display_name,
    municipality: primary.municipality || row.municipality,
    website: job.payload.known_website || primary.website || undefined,
    aliases: [...new Set(aliases)], source_records: records };
}

function assertPilotQueue(queue, config) {
  const total = queue.db.prepare("SELECT COUNT(*) AS count FROM enrichment_jobs").get().count;
  const status = queue.status();
  if (total !== config.inputs.pilot_database.expected_jobs) {
    throw new Error(`pilot database must contain ${config.inputs.pilot_database.expected_jobs} jobs, found ${total}`);
  }
  if (status.dead_letters || status.counts.cancelled) throw new Error("pilot queue has terminal failed jobs");
  if (!Object.values(status.counts).some(Boolean)) throw new Error("invalid pilot queue state");
}

function assertWarmPrecondition(queue, config) {
  const prior = queue.getRun(config.prior_run_id);
  if (!prior || prior.status !== "completed") throw new Error("warm pilot requires a completed prior_run_id");
  const eligible = queue.db.prepare(`SELECT COUNT(*) AS count FROM enrichment_jobs
    WHERE run_id = ? AND status = 'succeeded'`).get(config.prior_run_id).count;
  if (eligible !== config.inputs.pilot_database.expected_jobs) {
    throw new Error(`warm pilot requires ${config.inputs.pilot_database.expected_jobs} succeeded prior jobs, found ${eligible}`);
  }
}

function validateConfig(config) {
  if (!config || config.schema_version !== 1) throw new Error("unsupported pilot run manifest");
  if (!['cold', 'warm_incremental'].includes(config.scenario)) throw new Error("unsupported pilot scenario");
  if (config.scenario === "warm_incremental" && !String(config.prior_run_id || "").trim()) {
    throw new Error("warm pilot requires prior_run_id");
  }
  if (config.authorization?.live_pilot !== true) throw new Error("live pilot is not authorized by the run manifest");
  if (config.authorization?.national_queue !== false || config.authorization?.publication !== false) {
    throw new Error("pilot authorization must not authorize the national queue or publication");
  }
  if (config.request_budget?.combined_ceiling !== 72 || config.request_budget?.reserve !== 25) {
    throw new Error("pilot manifest must preserve the 72-request ceiling and 25-request reserve");
  }
  if (!config.request_budget.period) throw new Error("pilot budget period is required");
  if (config.worker?.concurrency !== 2 || config.provider?.concurrency !== 1
    || config.worker?.per_domain_concurrency !== 1 || config.provider?.requests_per_second !== 1) {
    throw new Error("pilot concurrency or pacing differs from the approved limits");
  }
  if (config.resolver?.searches_per_venue === 3
    && !String(config.resolver.budget_escalation_reason || "").trim()) {
    throw new Error("pilot third-search budget requires a resolver budget_escalation_reason");
  }
  return config;
}

function isAuthorizedResume(run, config) {
  if (!run || !["running", "completed", "failed", "cancelled"].includes(run.status)) return false;
  const pinned = run.configuration?.inputs;
  return run.run_id === config.run_id
    && pinned?.reviewed_selection?.sha256 === config.inputs.reviewed_selection.sha256
    && pinned?.pilot_database?.sha256 === config.inputs.pilot_database.sha256;
}

function verifySha256(path, expected, label) {
  const actual = sha256(path);
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function quotaAttempt(provider, reason) {
  return { provider, http_status: null, transport_ok: true, parse_ok: false,
    raw_count: 0, duration_ms: 0, rate_headers: {}, results: [], reason };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error(`invalid argument ${argv[index] || ""}`);
    }
    args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.manifest) {
    throw new Error("usage: node run-pilot.mjs --db PILOT.sqlite --manifest RUN.json");
  }
  const config = JSON.parse(readFileSync(resolve(args.manifest), "utf8"));
  console.log(JSON.stringify(await runPilot({ dbPath: args.db, config }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
