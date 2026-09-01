import { randomUUID } from "node:crypto";
import { EvidenceStore } from "./evidence-store.mjs";

const TERMINAL = new Set(["succeeded", "cancelled", "dead_letter"]);
const ACTIVE = new Set(["queued", "leased", "retry_scheduled"]);

export class EnrichmentQueue {
  constructor(storeOrPath, options = {}) {
    this.store = storeOrPath instanceof EvidenceStore
      ? storeOrPath : new EvidenceStore(storeOrPath, options.storeOptions);
    this.ownsStore = !(storeOrPath instanceof EvidenceStore);
    this.db = this.store.db;
    this.clock = options.clock || (() => new Date());
    this.random = options.random || Math.random;
    this.defaultLeaseMs = positiveInteger(options.leaseMs ?? 60_000, "leaseMs");
    this.baseBackoffMs = nonNegativeInteger(options.baseBackoffMs ?? 1_000, "baseBackoffMs");
    this.maxBackoffMs = nonNegativeInteger(options.maxBackoffMs ?? 3_600_000, "maxBackoffMs");
    this.jitterRatio = Math.max(0, Number(options.jitterRatio ?? 0.2));
  }

  close() { if (this.ownsStore) this.store.close(); }

  createRun(input = {}) {
    const now = timestamp(input.startedAt || this.clock());
    const runId = String(input.runId || randomUUID());
    this.db.prepare(`INSERT INTO run_manifests
      (run_id, status, code_version, scoring_version, source_health_json,
       configuration_json, started_at, created_at, updated_at)
      VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, String(input.codeVersion || "unknown"), String(input.scoringVersion || "unknown"),
        json(input.sourceHealth || {}), json(input.configuration || {}), now, now, now);
    return this.getRun(runId);
  }

  finishRun(runId, input = {}) {
    const now = timestamp(input.finishedAt || this.clock());
    const status = input.status || "completed";
    if (!["completed", "failed", "cancelled"].includes(status)) throw new Error(`invalid run status ${status}`);
    const changed = this.db.prepare(`UPDATE run_manifests SET status = ?, source_health_json = ?,
      finished_at = ?, updated_at = ? WHERE run_id = ? AND status = 'running'`)
      .run(status, json(input.sourceHealth || {}), now, now, runId).changes;
    if (!changed) throw new Error(`running manifest not found: ${runId}`);
    return this.getRun(runId);
  }

  getRun(runId) {
    const row = this.db.prepare("SELECT * FROM run_manifests WHERE run_id = ?").get(runId);
    return row ? publicRun(row) : null;
  }

  enqueue(input) {
    if (!input?.venue) throw new TypeError("queue job requires a venue");
    const stage = String(input.stage || "enrich").trim();
    if (!stage) throw new TypeError("queue job requires a stage");
    const now = timestamp(input.createdAt || this.clock());
    const venueId = this.store.rememberVenue(input.venue, {
      checkedAt: now, municipality: input.municipality || input.location?.municipality,
    });
    const idempotencyKey = String(input.idempotencyKey
      || `${venueId}:${stage}:${input.revision || "1"}`);
    const maxAttempts = positiveInteger(input.maxAttempts ?? 4, "maxAttempts");
    this.db.prepare(`INSERT INTO enrichment_jobs
      (idempotency_key, venue_id, run_id, stage, priority, status, payload_json,
       provider, domain, max_attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .run(idempotencyKey, venueId, input.runId || null, stage, integer(input.priority ?? 0, "priority"),
        json(input.payload || {}), normalizeKey(input.provider), normalizeDomain(input.domain),
        maxAttempts, timestamp(input.nextAttemptAt || now), now, now);
    return this.getByIdempotencyKey(idempotencyKey);
  }

  get(jobId) {
    const row = this.db.prepare("SELECT * FROM enrichment_jobs WHERE job_id = ?").get(jobId);
    return row ? publicJob(row) : null;
  }

  getByIdempotencyKey(key) {
    const row = this.db.prepare("SELECT * FROM enrichment_jobs WHERE idempotency_key = ?").get(key);
    return row ? publicJob(row) : null;
  }

  claim(workerId, options = {}) {
    if (!String(workerId || "").trim()) throw new TypeError("workerId is required");
    const now = timestamp(options.at || this.clock());
    const leaseMs = positiveInteger(options.leaseMs ?? this.defaultLeaseMs, "leaseMs");
    const limits = {
      global: finiteLimit(options.maxConcurrency),
      provider: finiteLimit(options.maxProviderConcurrency),
      domain: finiteLimit(options.maxDomainConcurrency),
    };
    return this.store.transaction(() => {
      this.#recoverExpired(now);
      const leased = this.db.prepare(`SELECT provider, domain FROM enrichment_jobs
        WHERE status = 'leased' AND lease_expires_at > ?`).all(now);
      if (leased.length >= limits.global) return null;
      const providerCounts = counts(leased, "provider");
      const domainCounts = counts(leased, "domain");
      const candidates = this.db.prepare(`SELECT * FROM enrichment_jobs
        WHERE status IN ('queued', 'retry_scheduled') AND next_attempt_at <= ?
          AND cancel_requested = 0
        ORDER BY priority DESC, next_attempt_at, job_id LIMIT 100`).all(now);
      const row = candidates.find((candidate) =>
        (!candidate.provider || (providerCounts.get(candidate.provider) || 0) < limits.provider)
        && (!candidate.domain || (domainCounts.get(candidate.domain) || 0) < limits.domain)
        && !this.#quotaIsPaused(candidate, now)
        && !this.#circuitIsOpen(candidate.provider, now));
      if (!row) return null;
      const token = randomUUID();
      const expiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
      const changed = this.db.prepare(`UPDATE enrichment_jobs SET status = 'leased',
        lease_owner = ?, lease_token = ?, lease_expires_at = ?, attempt_count = attempt_count + 1,
        updated_at = ? WHERE job_id = ? AND status IN ('queued', 'retry_scheduled')`)
        .run(workerId, token, expiresAt, now, row.job_id).changes;
      if (!changed) return null;
      const claimed = this.db.prepare("SELECT * FROM enrichment_jobs WHERE job_id = ?").get(row.job_id);
      this.db.prepare(`INSERT INTO enrichment_attempts
        (job_id, attempt_number, worker_id, lease_token, status, started_at)
        VALUES (?, ?, ?, ?, 'running', ?)`)
        .run(row.job_id, claimed.attempt_count, workerId, token, now);
      return publicJob(claimed);
    });
  }

  heartbeat(jobId, leaseToken, options = {}) {
    const now = timestamp(options.at || this.clock());
    const expiresAt = new Date(Date.parse(now)
      + positiveInteger(options.leaseMs ?? this.defaultLeaseMs, "leaseMs")).toISOString();
    const changed = this.db.prepare(`UPDATE enrichment_jobs SET lease_expires_at = ?, updated_at = ?
      WHERE job_id = ? AND status = 'leased' AND lease_token = ? AND lease_expires_at > ?`)
      .run(expiresAt, now, jobId, leaseToken, now).changes;
    if (!changed) throw leaseError(jobId);
    return this.get(jobId);
  }

  complete(jobId, leaseToken, result = {}, options = {}) {
    const now = timestamp(options.at || this.clock());
    return this.store.transaction(() => {
      const row = this.#requireLease(jobId, leaseToken, now);
      if (row.cancel_requested) return this.#finishCancelled(row, now);
      if (options.applyResult) {
        const applied = options.applyResult(result, publicJob(row), this.store);
        if (applied && typeof applied.then === "function") {
          throw new TypeError("applyResult must be synchronous so job and evidence commit atomically");
        }
      }
      this.db.prepare(`UPDATE enrichment_jobs SET status = 'succeeded', result_json = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
        updated_at = ?, finished_at = ? WHERE job_id = ?`)
        .run(json(result), now, now, jobId);
      this.db.prepare(`UPDATE enrichment_attempts SET status = 'succeeded', result_json = ?,
        finished_at = ? WHERE job_id = ? AND lease_token = ? AND status = 'running'`)
        .run(json(result), now, jobId, leaseToken);
      return this.get(jobId);
    });
  }

  fail(jobId, leaseToken, error, options = {}) {
    const now = timestamp(options.at || this.clock());
    return this.store.transaction(() => {
      const row = this.#requireLease(jobId, leaseToken, now);
      if (row.cancel_requested) return this.#finishCancelled(row, now);
      const message = String(error?.message || error || "worker failure").slice(0, 1_000);
      const retryable = options.retryable !== false;
      const dead = !retryable || row.attempt_count >= row.max_attempts;
      const status = dead ? "dead_letter" : "retry_scheduled";
      const nextAttemptAt = dead ? now : new Date(Date.parse(now) + this.#retryDelay(row.attempt_count)).toISOString();
      this.db.prepare(`UPDATE enrichment_jobs SET status = ?, next_attempt_at = ?, last_error = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
        updated_at = ?, finished_at = ? WHERE job_id = ?`)
        .run(status, nextAttemptAt, message, now, dead ? now : null, jobId);
      this.db.prepare(`UPDATE enrichment_attempts SET status = ?, error = ?, finished_at = ?
        WHERE job_id = ? AND lease_token = ? AND status = 'running'`)
        .run(status, message, now, jobId, leaseToken);
      return this.get(jobId);
    });
  }

  cancel(jobId, reason = "operator_cancelled", options = {}) {
    const now = timestamp(options.at || this.clock());
    return this.store.transaction(() => {
      const row = this.db.prepare("SELECT * FROM enrichment_jobs WHERE job_id = ?").get(jobId);
      if (!row) return null;
      if (TERMINAL.has(row.status)) return publicJob(row);
      if (row.status === "leased") {
        this.db.prepare(`UPDATE enrichment_jobs SET cancel_requested = 1, cancel_reason = ?,
          updated_at = ? WHERE job_id = ?`).run(String(reason), now, jobId);
      } else {
        this.db.prepare(`UPDATE enrichment_jobs SET status = 'cancelled', cancel_requested = 1,
          cancel_reason = ?, updated_at = ?, finished_at = ? WHERE job_id = ?`)
          .run(String(reason), now, now, jobId);
      }
      return this.get(jobId);
    });
  }

  isCancellationRequested(jobId, leaseToken) {
    const row = this.db.prepare(`SELECT cancel_requested FROM enrichment_jobs
      WHERE job_id = ? AND status = 'leased' AND lease_token = ?`).get(jobId, leaseToken);
    return !row || row.cancel_requested === 1;
  }

  recoverExpired(options = {}) {
    const now = timestamp(options.at || this.clock());
    return this.store.transaction(() => this.#recoverExpired(now));
  }

  retry(jobId, options = {}) {
    const now = timestamp(options.at || this.clock());
    const changed = this.db.prepare(`UPDATE enrichment_jobs SET status = 'queued', attempt_count = 0,
      next_attempt_at = ?, cancel_requested = 0, cancel_reason = NULL, last_error = NULL,
      finished_at = NULL, updated_at = ? WHERE job_id = ? AND status IN ('dead_letter', 'cancelled')`)
      .run(now, now, jobId).changes;
    if (!changed) throw new Error(`job ${jobId} is not retryable`);
    return this.get(jobId);
  }

  configureBudget(scope, key, limit, options = {}) {
    validateScope(scope);
    const now = timestamp(options.at || this.clock());
    const period = String(options.period || now.slice(0, 10));
    this.db.prepare(`INSERT INTO request_budgets
      (scope, scope_key, period, request_limit, requests_used, updated_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(scope, scope_key, period) DO UPDATE SET
        request_limit = excluded.request_limit, updated_at = excluded.updated_at`)
      .run(scope, normalizeKey(key), period, nonNegativeInteger(limit, "limit"), now);
    return this.db.prepare(`SELECT * FROM request_budgets
      WHERE scope = ? AND scope_key = ? AND period = ?`).get(scope, normalizeKey(key), period);
  }

  reserveRequests(scopes, count = 1, options = {}) {
    const now = timestamp(options.at || this.clock());
    const period = String(options.period || now.slice(0, 10));
    const amount = positiveInteger(count, "request count");
    const wanted = uniqueScopes(scopes);
    return this.store.transaction(() => {
      const rows = wanted.map(({ scope, key }) => {
        validateScope(scope);
        return this.db.prepare(`SELECT * FROM request_budgets
          WHERE scope = ? AND scope_key = ? AND period = ?`).get(scope, normalizeKey(key), period);
      }).filter(Boolean);
      const exhausted = rows.find((row) => row.requests_used + amount > row.request_limit);
      if (exhausted) {
        const error = new Error(`${exhausted.scope} request budget exhausted for ${exhausted.scope_key}`);
        error.code = "REQUEST_BUDGET_EXHAUSTED";
        error.budget = { ...exhausted };
        throw error;
      }
      for (const row of rows) this.db.prepare(`UPDATE request_budgets
        SET requests_used = requests_used + ?, updated_at = ?
        WHERE scope = ? AND scope_key = ? AND period = ?`)
        .run(amount, now, row.scope, row.scope_key, period);
      return rows.map((row) => ({ ...row, requests_used: row.requests_used + amount }));
    });
  }

  pauseForQuota(scope, key, input = {}, options = {}) {
    validateScope(scope);
    const scopeKey = normalizeKey(key);
    if (!scopeKey) throw new TypeError("quota pause key is required");
    const now = timestamp(options.at || this.clock());
    const resumeAfter = optionalTimestamp(input.resumeAfter || input.retryAfter);
    const reason = String(input.reason || "provider_quota_exhausted");
    this.db.prepare(`INSERT INTO quota_pauses
      (scope, scope_key, reason, paused_at, resume_after, details_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, scope_key) DO UPDATE SET reason = excluded.reason,
        paused_at = excluded.paused_at, resume_after = excluded.resume_after,
        details_json = excluded.details_json, updated_at = excluded.updated_at`)
      .run(scope, scopeKey, reason, now, resumeAfter, json(input.details || {}), now);
    return this.getQuotaPause(scope, scopeKey);
  }

  getQuotaPause(scope, key) {
    validateScope(scope);
    const row = this.db.prepare(`SELECT * FROM quota_pauses
      WHERE scope = ? AND scope_key = ?`).get(scope, normalizeKey(key));
    return row ? publicQuotaPause(row) : null;
  }

  resumeQuota(scope, key, options = {}) {
    validateScope(scope);
    const now = timestamp(options.at || this.clock());
    const scopeKey = normalizeKey(key);
    const pause = this.getQuotaPause(scope, scopeKey);
    if (!pause) return null;
    this.db.prepare("DELETE FROM quota_pauses WHERE scope = ? AND scope_key = ?")
      .run(scope, scopeKey);
    return { ...pause, resumed_at: now };
  }

  recordProviderOutcome(provider, outcome = {}, options = {}) {
    const key = normalizeKey(provider);
    if (!key) return null;
    const now = timestamp(options.at || this.clock());
    const threshold = positiveInteger(options.failureThreshold ?? 3, "failureThreshold");
    const cooldownMs = nonNegativeInteger(options.cooldownMs ?? 30_000, "cooldownMs");
    return this.store.transaction(() => {
      const current = this.db.prepare("SELECT * FROM provider_circuits WHERE provider = ?").get(key);
      const failures = outcome.ok ? 0 : (current?.consecutive_failures || 0) + 1;
      const open = !outcome.ok && failures >= threshold;
      const openUntil = open ? new Date(Date.parse(now) + cooldownMs).toISOString() : null;
      this.db.prepare(`INSERT INTO provider_circuits
        (provider, state, consecutive_failures, failure_threshold, open_until, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET state = excluded.state,
          consecutive_failures = excluded.consecutive_failures,
          failure_threshold = excluded.failure_threshold, open_until = excluded.open_until,
          updated_at = excluded.updated_at`)
        .run(key, open ? "open" : "closed", failures, threshold, openUntil, now);
      return this.db.prepare("SELECT * FROM provider_circuits WHERE provider = ?").get(key);
    });
  }

  status() {
    const countsByStatus = Object.fromEntries(this.db.prepare(`SELECT status, COUNT(*) AS count
      FROM enrichment_jobs GROUP BY status ORDER BY status`).all().map((row) => [row.status, row.count]));
    const retryReady = this.db.prepare(`SELECT COUNT(*) AS count FROM enrichment_jobs
      WHERE status IN ('queued', 'retry_scheduled') AND next_attempt_at <= ?`).get(timestamp(this.clock())).count;
    return {
      counts: countsByStatus,
      active: Object.entries(countsByStatus).filter(([key]) => ACTIVE.has(key))
        .reduce((sum, [, value]) => sum + value, 0),
      ready: retryReady,
      dead_letters: countsByStatus.dead_letter || 0,
      cancellation_requested: this.db.prepare(`SELECT COUNT(*) AS count FROM enrichment_jobs
        WHERE status = 'leased' AND cancel_requested = 1`).get().count,
      quota_pauses: this.db.prepare("SELECT * FROM quota_pauses ORDER BY scope, scope_key")
        .all().map(publicQuotaPause),
    };
  }

  exportLegacyScan(options = {}) { return this.store.exportLegacyScan(options); }

  async processOne(workerId, handler, options = {}) {
    const job = this.claim(workerId, options);
    if (!job) return null;
    const context = {
      heartbeat: (leaseMs) => this.heartbeat(job.job_id, job.lease_token, { leaseMs }),
      isCancellationRequested: () => this.isCancellationRequested(job.job_id, job.lease_token),
      reserveRequests: (count = 1, extraScopes = [], reserveOptions = {}) => this.reserveRequests([
        { scope: "global", key: "all" },
        ...(job.provider ? [{ scope: "provider", key: job.provider }] : []),
        ...(job.domain ? [{ scope: "domain", key: job.domain }] : []),
        ...extraScopes,
      ], count, reserveOptions),
      recordProviderOutcome: (outcome, circuitOptions) =>
        this.recordProviderOutcome(job.provider, outcome, circuitOptions),
      pauseProviderQuota: (input = {}) => {
        throw providerQuotaError({ provider: input.provider || job.provider, ...input });
      },
      assertProviderAvailable: (response, input = {}) => {
        const quota = quotaSignal(response, { provider: input.provider || job.provider,
          now: this.clock().getTime() });
        if (quota) throw providerQuotaError(quota);
        return response;
      },
    };
    try {
      const result = await handler(job, context);
      const quota = quotaSignal(result, { provider: job.provider, now: this.clock().getTime() });
      if (quota) throw providerQuotaError(quota);
      return this.complete(job.job_id, job.lease_token, result, options);
    } catch (error) {
      const quota = quotaSignal(error, { provider: job.provider, now: this.clock().getTime() });
      if (quota) return this.#releaseForQuota(job, error, quota, options);
      return this.fail(job.job_id, job.lease_token, error, {
        ...options, retryable: error?.retryable !== false,
      });
    }
  }

  #requireLease(jobId, token, now) {
    const row = this.db.prepare("SELECT * FROM enrichment_jobs WHERE job_id = ?").get(jobId);
    if (!row || row.status !== "leased" || row.lease_token !== token || row.lease_expires_at <= now) {
      throw leaseError(jobId);
    }
    return row;
  }

  #finishCancelled(row, now) {
    this.db.prepare(`UPDATE enrichment_jobs SET status = 'cancelled', lease_owner = NULL,
      lease_token = NULL, lease_expires_at = NULL, updated_at = ?, finished_at = ?
      WHERE job_id = ?`).run(now, now, row.job_id);
    this.db.prepare(`UPDATE enrichment_attempts SET status = 'cancelled', finished_at = ?
      WHERE job_id = ? AND lease_token = ? AND status = 'running'`)
      .run(now, row.job_id, row.lease_token);
    return this.get(row.job_id);
  }

  #releaseForQuota(job, error, quota, options = {}) {
    const now = timestamp(options.at || this.clock());
    return this.store.transaction(() => {
      const row = this.#requireLease(job.job_id, job.lease_token, now);
      const scope = quota.scope || "provider";
      const key = quota.key || quota.provider || row.provider;
      if (!key) throw new Error("quota exhaustion requires a provider or scoped key");
      const pause = this.pauseForQuota(scope, key, {
        reason: quota.reason,
        resumeAfter: quota.resume_after,
        details: { http_status: quota.http_status ?? null,
          rate_headers: quota.rate_headers || {}, message: String(error?.message || error || quota.reason) },
      }, { at: now });
      this.db.prepare(`UPDATE enrichment_jobs SET status = 'queued',
        attempt_count = MAX(0, attempt_count - 1), next_attempt_at = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
        last_error = ?, updated_at = ?, finished_at = NULL WHERE job_id = ?`)
        .run(pause.resume_after || now, quota.reason, now, row.job_id);
      this.db.prepare(`DELETE FROM enrichment_attempts
        WHERE job_id = ? AND lease_token = ? AND status = 'running'`)
        .run(row.job_id, row.lease_token);
      return { ...this.get(row.job_id), worker_stop_reason: "quota_paused", quota_pause: pause };
    });
  }

  #recoverExpired(now) {
    const rows = this.db.prepare(`SELECT * FROM enrichment_jobs
      WHERE status = 'leased' AND lease_expires_at <= ? ORDER BY job_id`).all(now);
    for (const row of rows) {
      const cancelled = row.cancel_requested === 1;
      const dead = !cancelled && row.attempt_count >= row.max_attempts;
      const status = cancelled ? "cancelled" : dead ? "dead_letter" : "retry_scheduled";
      this.db.prepare(`UPDATE enrichment_jobs SET status = ?, next_attempt_at = ?,
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
        last_error = ?, updated_at = ?, finished_at = ? WHERE job_id = ?`)
        .run(status, now, cancelled ? row.last_error : "worker_lease_expired", now,
          cancelled || dead ? now : null, row.job_id);
      this.db.prepare(`UPDATE enrichment_attempts SET status = 'lease_expired',
        error = 'worker_lease_expired', finished_at = ?
        WHERE job_id = ? AND lease_token = ? AND status = 'running'`)
        .run(now, row.job_id, row.lease_token);
    }
    return rows.length;
  }

  #circuitIsOpen(provider, now) {
    if (!provider) return false;
    const row = this.db.prepare("SELECT * FROM provider_circuits WHERE provider = ?").get(provider);
    if (!row || row.state !== "open") return false;
    if (row.open_until > now) return true;
    this.db.prepare(`UPDATE provider_circuits SET state = 'closed', consecutive_failures = 0,
      open_until = NULL, updated_at = ? WHERE provider = ?`).run(now, provider);
    return false;
  }

  #quotaIsPaused(job, now) {
    const scopes = [{ scope: "global", key: "all" },
      ...(job.provider ? [{ scope: "provider", key: job.provider }] : []),
      ...(job.domain ? [{ scope: "domain", key: job.domain }] : [])];
    for (const item of scopes) {
      const pause = this.getQuotaPause(item.scope, item.key);
      if (!pause) continue;
      if (!pause.resume_after || pause.resume_after > now) return true;
      this.resumeQuota(item.scope, item.key, { at: now });
    }
    return false;
  }

  #retryDelay(attempt) {
    const exponential = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
    return Math.round(exponential + exponential * this.jitterRatio * this.random());
  }
}

export async function runEnrichmentWorker(queue, workerId, handler, options = {}) {
  if (!(queue instanceof EnrichmentQueue)) throw new TypeError("worker requires an EnrichmentQueue");
  if (typeof handler !== "function") throw new TypeError("worker handler must be a function");
  const signal = options.signal;
  const idleWaitMs = nonNegativeInteger(options.idleWaitMs ?? 1_000, "idleWaitMs");
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let processed = 0;
  while (!signal?.aborted) {
    const result = await queue.processOne(workerId, handler, options);
    if (result?.worker_stop_reason === "quota_paused") {
      return { processed, stopped: "quota_paused", quota_pause: result.quota_pause };
    }
    if (result) { processed++; continue; }
    if (options.stopWhenIdle !== false) break;
    await sleep(idleWaitMs);
  }
  return { processed, stopped: signal?.aborted ? "aborted" : "idle" };
}

function publicJob(row) {
  return {
    ...row,
    payload: parseJson(row.payload_json),
    result: row.result_json ? parseJson(row.result_json) : null,
    cancel_requested: row.cancel_requested === 1,
  };
}

function publicRun(row) {
  return { ...row, source_health: parseJson(row.source_health_json),
    configuration: parseJson(row.configuration_json) };
}

function publicQuotaPause(row) {
  return { ...row, details: parseJson(row.details_json) };
}

export function providerQuotaError(input = {}) {
  const error = new Error(String(input.message || input.reason || "provider quota exhausted"));
  error.code = "PROVIDER_QUOTA_EXHAUSTED";
  Object.assign(error, input);
  return error;
}

function quotaSignal(value, defaults = {}) {
  if (!value || typeof value !== "object") return null;
  if (value.code === "REQUEST_BUDGET_EXHAUSTED") {
    const budget = value.budget || {};
    return { scope: budget.scope || "global", key: budget.scope_key || "all",
      provider: defaults.provider, reason: "local_request_budget_exhausted" };
  }
  const nestedResponses = [
    ...(Array.isArray(value.search_attempts) ? value.search_attempts : []),
    ...(Array.isArray(value.resource_search_attempts) ? value.resource_search_attempts : []),
    ...(Array.isArray(value.enrichment_run?.search_attempts) ? value.enrichment_run.search_attempts : []),
    ...(Array.isArray(value.enrichment_run?.resource_search_attempts)
      ? value.enrichment_run.resource_search_attempts : []),
  ];
  const response = value.searchResponse || value.response
    || nestedResponses.find((item) => ["rate_limited", "budget_exhausted", "provider_failed"].includes(item?.outcome))
    || value;
  const attempts = Array.isArray(response.attempts) ? response.attempts : [];
  const lastAttempt = attempts.at(-1) || {};
  if (value.code === "PROVIDER_UNAVAILABLE" || response.outcome === "provider_failed") {
    return { scope: "provider", key: value.key,
      provider: value.provider || response.provider || lastAttempt.provider || defaults.provider,
      reason: "provider_unavailable", http_status: response.http_status ?? null,
      rate_headers: {}, resume_after: null };
  }
  const limited = value.code === "PROVIDER_QUOTA_EXHAUSTED"
    || ["rate_limited", "budget_exhausted"].includes(response.outcome) || response.http_status === 429
    || (lastAttempt.http_status === 429 && response.outcome !== "relevant");
  if (!limited) return null;
  const localBudgetExhausted = value.reason === "local_request_budget_exhausted"
    || response.outcome === "budget_exhausted"
    || lastAttempt.reason === "budget_exhausted";
  const headers = value.rate_headers || response.rate_headers || lastAttempt.rate_headers || {};
  return { scope: value.scope || "provider", key: value.key,
    provider: value.provider || response.provider || lastAttempt.provider || defaults.provider,
    reason: value.reason || (localBudgetExhausted
      ? "local_request_budget_exhausted" : "provider_rate_limited"),
    http_status: localBudgetExhausted ? null : 429,
    rate_headers: headers, resume_after: value.resume_after || resetTimestamp(headers, defaults.now) };
}

function resetTimestamp(headers = {}, nowMs = Date.now()) {
  const raw = Object.entries(headers).find(([key]) =>
    ["retry-after", "x-ratelimit-reset"].includes(key.toLowerCase()))?.[1];
  if (raw === undefined || raw === null || raw === "") return null;
  const values = String(raw).split(",").map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0);
  if (values.length) {
    const value = Math.max(...values);
    return new Date(value > 1_000_000_000 ? value * 1_000 : nowMs + value * 1_000).toISOString();
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function counts(rows, key) {
  const result = new Map();
  for (const row of rows) result.set(row[key], (result.get(row[key]) || 0) + 1);
  return result;
}

function uniqueScopes(scopes) {
  const seen = new Set();
  return (Array.isArray(scopes) ? scopes : []).filter((item) => {
    const id = `${item?.scope}:${normalizeKey(item?.key)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function validateScope(value) {
  if (!["global", "provider", "domain"].includes(value)) throw new Error(`invalid budget scope ${value}`);
}

function normalizeKey(value) { return String(value || "").trim().toLowerCase(); }
function normalizeDomain(value) {
  const raw = normalizeKey(value);
  if (!raw) return "";
  try { return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); }
  catch { return raw; }
}
function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("invalid queue timestamp");
  return date.toISOString();
}
function optionalTimestamp(value) { return value ? timestamp(value) : null; }
function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new TypeError(`${label} must be an integer`);
  return number;
}
function nonNegativeInteger(value, label) {
  const number = integer(value, label);
  if (number < 0) throw new TypeError(`${label} must be non-negative`);
  return number;
}
function positiveInteger(value, label) {
  const number = integer(value, label);
  if (number < 1) throw new TypeError(`${label} must be positive`);
  return number;
}
function finiteLimit(value) {
  if (value === undefined || value === null) return Infinity;
  return positiveInteger(value, "concurrency limit");
}
function leaseError(jobId) {
  const error = new Error(`job ${jobId} lease is no longer owned by this worker`);
  error.code = "LEASE_LOST";
  return error;
}
function json(value) { return JSON.stringify(value ?? null); }
function parseJson(value) { try { return JSON.parse(value); } catch { return {}; } }
