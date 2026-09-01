import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeScanDocument } from "../scan-schema.mjs";
import { EnrichmentQueue, runEnrichmentWorker } from "./enrichment-queue.mjs";

test("priority claims honor concurrency and idempotent enqueue", async (t) => {
  const fixture = await queueFixture(t);
  const low = fixture.queue.enqueue(jobInput("low", { priority: 1, provider: "brave", domain: "a.test" }));
  const high = fixture.queue.enqueue(jobInput("high", { priority: 9, provider: "brave", domain: "b.test" }));
  assert.equal(fixture.queue.enqueue(jobInput("high", { priority: 2 })).job_id, high.job_id);

  const claimed = fixture.queue.claim("worker-1", { maxConcurrency: 2, maxProviderConcurrency: 1 });
  assert.equal(claimed.job_id, high.job_id);
  assert.equal(fixture.queue.claim("worker-2", { maxConcurrency: 2, maxProviderConcurrency: 1 }), null);
  fixture.queue.complete(claimed.job_id, claimed.lease_token, { ok: true });
  assert.equal(fixture.queue.claim("worker-2").job_id, low.job_id);
});

test("expired lease recovery survives restart and atomically applies an idempotent result", async (t) => {
  const fixture = await queueFixture(t, { leaseMs: 1_000 });
  const original = fixture.queue.enqueue(jobInput("restart"));
  const abandoned = fixture.queue.claim("worker-that-died");
  fixture.queue.close();

  fixture.clock.advance(1_001);
  const restarted = new EnrichmentQueue(fixture.path, {
    clock: fixture.clock.now, leaseMs: 1_000, jitterRatio: 0,
  });
  fixture.queue = restarted;
  assert.equal(restarted.recoverExpired(), 1);
  const replacement = restarted.claim("replacement-worker");
  assert.equal(replacement.job_id, original.job_id);
  assert.equal(replacement.attempt_count, 2);
  assert.notEqual(replacement.lease_token, abandoned.lease_token);
  assert.throws(() => restarted.complete(original.job_id, abandoned.lease_token, {}), { code: "LEASE_LOST" });

  restarted.complete(replacement.job_id, replacement.lease_token, acceptedEnrichment(), {
    applyResult: (result, _job, store) => store.recordEnrichment(venue("restart"), result, {
      checkedAt: fixture.clock.now(), municipality: "Oderzo",
    }),
  });
  assert.equal(restarted.get(original.job_id).status, "succeeded");
  assert.equal(restarted.enqueue(jobInput("restart")).job_id, original.job_id);
  assert.equal(restarted.db.prepare("SELECT COUNT(*) AS count FROM facts").get().count, 2);
  assert.equal(restarted.db.prepare("SELECT COUNT(*) AS count FROM enrichment_attempts").get().count, 2);
});

test("retries use bounded backoff, then dead-letter and operator retry", async (t) => {
  const fixture = await queueFixture(t, { baseBackoffMs: 1_000, maxBackoffMs: 2_000 });
  const queued = fixture.queue.enqueue(jobInput("failure", { maxAttempts: 2 }));
  const first = fixture.queue.claim("worker");
  const retry = fixture.queue.fail(first.job_id, first.lease_token, new Error("temporary"));
  assert.equal(retry.status, "retry_scheduled");
  assert.equal(Date.parse(retry.next_attempt_at) - fixture.clock.value(), 1_000);
  assert.equal(fixture.queue.claim("too-early"), null);

  fixture.clock.advance(1_000);
  const second = fixture.queue.claim("worker");
  const dead = fixture.queue.fail(second.job_id, second.lease_token, new Error("still down"));
  assert.equal(dead.status, "dead_letter");
  assert.equal(fixture.queue.status().dead_letters, 1);
  const retried = fixture.queue.retry(queued.job_id);
  assert.equal(retried.status, "queued");
  assert.equal(retried.attempt_count, 0);
});

test("cancellation is immediate before lease and cooperative during work", async (t) => {
  const fixture = await queueFixture(t);
  const waiting = fixture.queue.enqueue(jobInput("waiting"));
  assert.equal(fixture.queue.cancel(waiting.job_id, "no longer needed").status, "cancelled");

  const active = fixture.queue.enqueue(jobInput("active"));
  const leased = fixture.queue.claim("worker");
  assert.equal(leased.job_id, active.job_id);
  assert.equal(fixture.queue.cancel(active.job_id, "stop requested").status, "leased");
  assert.equal(fixture.queue.isCancellationRequested(active.job_id, leased.lease_token), true);
  let applied = false;
  const cancelled = fixture.queue.complete(active.job_id, leased.lease_token, { ignored: true }, {
    applyResult: () => { applied = true; },
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(applied, false);
});

test("request budgets are atomic and persistent circuit breakers gate provider jobs", async (t) => {
  const fixture = await queueFixture(t);
  fixture.queue.configureBudget("global", "all", 2);
  fixture.queue.configureBudget("provider", "brave", 1);
  fixture.queue.reserveRequests([
    { scope: "global", key: "all" }, { scope: "provider", key: "brave" },
  ]);
  assert.throws(() => fixture.queue.reserveRequests([
    { scope: "global", key: "all" }, { scope: "provider", key: "brave" },
  ]), { code: "REQUEST_BUDGET_EXHAUSTED" });
  assert.equal(fixture.queue.db.prepare(`SELECT requests_used FROM request_budgets
    WHERE scope = 'global'`).get().requests_used, 1, "failed reservation must not partially spend global budget");

  fixture.queue.enqueue(jobInput("circuit", { provider: "brave" }));
  fixture.queue.recordProviderOutcome("brave", { ok: false }, { failureThreshold: 2, cooldownMs: 5_000 });
  const circuit = fixture.queue.recordProviderOutcome("brave", { ok: false },
    { failureThreshold: 2, cooldownMs: 5_000 });
  assert.equal(circuit.state, "open");
  assert.equal(fixture.queue.claim("blocked"), null);
  fixture.clock.advance(5_001);
  assert.ok(fixture.queue.claim("after-cooldown"));
});

test("run manifests and legacy JSON export remain loadable by the UI boundary", async (t) => {
  const fixture = await queueFixture(t);
  const run = fixture.queue.createRun({ runId: "session-8-fixture", codeVersion: "abc123",
    scoringVersion: "resources-v2", configuration: { offline: true } });
  const queued = fixture.queue.enqueue(jobInput("export", { runId: run.run_id }));
  const claimed = fixture.queue.claim("worker");
  fixture.queue.complete(queued.job_id, claimed.lease_token, acceptedEnrichment(), {
    applyResult: (result, _job, store) => store.recordEnrichment(venue("export"), result, {
      checkedAt: fixture.clock.now(), municipality: "Oderzo",
    }),
  });
  const finished = fixture.queue.finishRun(run.run_id, { sourceHealth: { brave: "fixture_only" } });
  assert.equal(finished.status, "completed");
  const exported = normalizeScanDocument(fixture.queue.exportLegacyScan({ municipality: "Oderzo" }));
  assert.equal(exported.restaurants.length, 1);
  assert.equal(exported.restaurants[0].website, "https://export.example/");
  assert.equal(exported.restaurants[0].resources.length, 1);
});

test("worker loop drains ready jobs and stops cleanly when idle", async (t) => {
  const fixture = await queueFixture(t);
  fixture.queue.enqueue(jobInput("worker-a"));
  fixture.queue.enqueue(jobInput("worker-b"));
  const handled = [];
  const result = await runEnrichmentWorker(fixture.queue, "drain-worker", async (job, context) => {
    handled.push(job.payload.fixture);
    assert.equal(context.isCancellationRequested(), false);
    return { fixture: job.payload.fixture };
  });
  assert.equal(result.processed, 2);
  assert.equal(result.stopped, "idle");
  assert.deepEqual(handled, ["worker-a", "worker-b"]);
  assert.equal(fixture.queue.status().counts.succeeded, 2);
});

test("local provider budget exhaustion pauses durably without spending a job attempt", async (t) => {
  const fixture = await queueFixture(t);
  const first = fixture.queue.enqueue(jobInput("budget-first", { provider: "brave_web_api" }));
  fixture.queue.enqueue(jobInput("budget-second", { provider: "brave_web_api" }));
  fixture.queue.configureBudget("provider", "brave_web_api", 0);

  const stopped = await runEnrichmentWorker(fixture.queue, "budget-worker", async (_job, context) => {
    context.reserveRequests();
    return { should_not_complete: true };
  });
  assert.equal(stopped.stopped, "quota_paused");
  assert.equal(stopped.processed, 0);
  assert.equal(fixture.queue.get(first.job_id).status, "queued");
  assert.equal(fixture.queue.get(first.job_id).attempt_count, 0);
  assert.equal(fixture.queue.db.prepare("SELECT COUNT(*) AS count FROM enrichment_attempts").get().count, 0);
  assert.equal(fixture.queue.getQuotaPause("provider", "brave_web_api").reason,
    "local_request_budget_exhausted");

  fixture.queue.close();
  fixture.queue = new EnrichmentQueue(fixture.path, { clock: fixture.clock.now, jitterRatio: 0 });
  assert.equal(fixture.queue.claim("blocked-after-restart"), null);
  fixture.queue.configureBudget("provider", "brave_web_api", 2);
  fixture.queue.resumeQuota("provider", "brave_web_api");
  const resumed = await runEnrichmentWorker(fixture.queue, "resumed-worker", async (_job, context) => {
    context.reserveRequests();
    return { ok: true };
  });
  assert.equal(resumed.stopped, "idle");
  assert.equal(resumed.processed, 2);
  assert.equal(fixture.queue.status().counts.succeeded, 2);
});

test("nested synthetic budget exhaustion is not reported as provider rate limiting", async (t) => {
  const fixture = await queueFixture(t);
  fixture.queue.enqueue(jobInput("nested-budget", { provider: "brave_web_api" }));

  const stopped = await runEnrichmentWorker(fixture.queue, "nested-budget-worker", async () => ({
    enrichment_run: {
      search_attempts: [{
        provider: "brave_web_api",
        outcome: "budget_exhausted",
        attempts: [{ provider: "brave_web_api", reason: "budget_exhausted" }],
      }],
    },
  }));

  assert.equal(stopped.stopped, "quota_paused");
  const pause = fixture.queue.getQuotaPause("provider", "brave_web_api");
  assert.equal(pause.reason, "local_request_budget_exhausted");
  assert.equal(pause.details.http_status, null);
});

test("Brave HTTP 429 pauses until reset and then resumes the same job idempotently", async (t) => {
  const fixture = await queueFixture(t);
  const queued = fixture.queue.enqueue(jobInput("rate-limit", { provider: "brave_web_api" }));
  let calls = 0;
  const stopped = await runEnrichmentWorker(fixture.queue, "limited-worker", async (_job, context) => {
    calls++;
    context.assertProviderAvailable({ provider: "brave_web_api", outcome: "rate_limited",
      attempts: [{ provider: "brave_web_api", http_status: 429,
        rate_headers: { "retry-after": "60" } }] });
  });
  assert.equal(stopped.stopped, "quota_paused");
  assert.equal(fixture.queue.get(queued.job_id).attempt_count, 0);
  assert.equal(fixture.queue.getQuotaPause("provider", "brave_web_api").resume_after,
    "2026-08-27T10:01:00.000Z");

  fixture.queue.close();
  fixture.queue = new EnrichmentQueue(fixture.path, { clock: fixture.clock.now, jitterRatio: 0 });
  assert.equal(fixture.queue.claim("before-reset"), null);
  fixture.clock.advance(60_001);
  const resumed = await runEnrichmentWorker(fixture.queue, "after-reset", async () => {
    calls++;
    return { ok: true };
  });
  assert.equal(resumed.processed, 1);
  assert.equal(calls, 2);
  assert.equal(fixture.queue.get(queued.job_id).status, "succeeded");
  assert.equal(fixture.queue.get(queued.job_id).attempt_count, 1);
  assert.equal(fixture.queue.getQuotaPause("provider", "brave_web_api"), null);
});

test("nested rate-limited enrichment cannot be committed as a successful no-result", async (t) => {
  const fixture = await queueFixture(t);
  const queued = fixture.queue.enqueue(jobInput("nested-limit", { provider: "brave_web_api" }));
  let applied = false;
  const result = await fixture.queue.processOne("nested-worker", async () => ({
    website_decision: { status: "review" }, resources: [], no_resources_found: true,
    enrichment_run: { resolver_status: "budget_exhausted",
      search_attempts: [{ provider: "brave_web_api", outcome: "rate_limited",
        attempts: [{ provider: "brave_web_api", http_status: 429,
          rate_headers: { "retry-after": "30" } }] }] },
  }), { applyResult: () => { applied = true; } });
  assert.equal(result.worker_stop_reason, "quota_paused");
  assert.equal(applied, false);
  assert.equal(fixture.queue.get(queued.job_id).status, "queued");
  assert.equal(fixture.queue.get(queued.job_id).result, null);
  assert.equal(fixture.queue.db.prepare("SELECT COUNT(*) AS count FROM facts").get().count, 0);
});

async function queueFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "restaurant-queue-"));
  const path = join(directory, "evidence.sqlite");
  const clock = fakeClock();
  const fixture = { directory, path, clock, queue: new EnrichmentQueue(path, {
    clock: clock.now, random: () => 0, jitterRatio: 0, ...options,
  }) };
  t.after(async () => {
    try { fixture.queue.close(); } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return fixture;
}

function fakeClock(initial = "2026-08-27T10:00:00.000Z") {
  let current = Date.parse(initial);
  return { now: () => new Date(current), value: () => current, advance: (ms) => { current += ms; } };
}

function jobInput(id, overrides = {}) {
  return { venue: venue(id), municipality: "Oderzo", stage: "website_and_resources",
    idempotencyKey: `fixture:${id}:v1`, payload: { fixture: id }, ...overrides };
}

function venue(id) {
  return { canonical_venue_id: `venue:oderzo:${id}`, name: id,
    aliases: [id], source_records: [{ source_record_id: `fixture:${id}`, source: "fixture", name: id }],
    merge_audit: [] };
}

function acceptedEnrichment() {
  const id = "export";
  return {
    website: `https://${id}.example/`, website_confidence: "high",
    website_decision: { status: "accepted", scores: { identity: 100, geography: 100, officialness: 100 },
      evidence: ["fixture"] },
    website_provenance: { source: "fixture", source_url: `https://${id}.example/` },
    resources: [{ role: "menu", type: "webpage", url: `https://${id}.example/menu`,
      found_via: "official_website", source_url: `https://${id}.example/`, evidence: ["fixture"] }],
    resource_decisions: [], enrichment_run: { resolver_status: "accepted", search_attempts: [],
      crawl_attempts: [] },
  };
}
