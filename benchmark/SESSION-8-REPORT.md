# Session 8 report — durable venue store and enrichment queue

Date: 2026-08-27
Decision: **Complete — offline exit criteria pass**
Scaling activity: **none started**

## Outcome

The SQLite evidence store now includes a durable, resumable enrichment queue.
Jobs have stable idempotency keys, explicit stages and priorities, bounded
attempt counts, scheduled retry times, worker leases, cooperative cancellation,
terminal results, and per-attempt audit rows. Run manifests retain the code,
scoring, configuration, and source-health versions for each batch.

SQLite remains the selected store for the single-workstation pilot. Queue
operations are serialized with `BEGIN IMMEDIATE`, but the public queue contract
uses ordinary job/lease/budget concepts so a future PostgreSQL implementation
does not need to expose SQLite behavior.

## Job lifecycle

```text
queued -> leased -> succeeded
   ^         |
   |         +-> retry_scheduled -> leased
   |         +-> dead_letter
   |         +-> cancelled
   +---------+  expired lease recovery
```

- A claim receives a random lease token. Only that unexpired token can
  heartbeat, complete, or fail the attempt.
- Expired work is recovered after a crash and becomes immediately claimable,
  unless it exhausted its attempts or had a cancellation request.
- Retry delay is exponential, bounded, and jittered. Tests inject deterministic
  time and randomness.
- Re-enqueuing the same idempotency key returns the original job. A new data or
  scoring revision must use a new revision in the key.
- Applying an enrichment result and marking its job successful happen in one
  SQLite transaction. A failed apply rolls back both operations.
- Network work remains at-least-once after a crash; durable evidence application
  is idempotent. Workers should continue to use the existing URL/search caches.

## Operational controls

The queue enforces global, provider, and domain concurrency when leasing.
Request reservations atomically spend configured daily global/provider/domain
budgets, so one exhausted scope cannot partially spend the others. Provider
circuit state is durable and prevents new claims until its cooldown expires.
The existing provider scheduler continues to own per-request pacing and retry
headers.

The worker helper drains ready jobs or can remain resident until its abort
signal requests a graceful stop. A leased cancellation is cooperative: the
worker can observe it, and completion refuses to apply a result after the
request.

Operator commands:

```bash
node queue-ops.mjs status --db data/evidence.sqlite
node queue-ops.mjs jobs --db data/evidence.sqlite --status dead_letter
node queue-ops.mjs recover --db data/evidence.sqlite
node queue-ops.mjs cancel 42 --db data/evidence.sqlite --reason "operator review"
node queue-ops.mjs retry 42 --db data/evidence.sqlite
node queue-ops.mjs export --db data/evidence.sqlite --municipality Oderzo \
  --output output/oderzo/durable-export.json
```

`EVIDENCE_DB_PATH` can replace `--db`. The export deliberately uses the legacy
scan boundary accepted by `normalizeScanDocument()`, so the existing UI can
load accepted active websites and resources without a UI migration.

## Schema and files

- Evidence schema version increased from 1 to 2.
- New tables: `run_manifests`, `enrichment_jobs`, `enrichment_attempts`,
  `request_budgets`, and `provider_circuits`.
- `lib/enrichment-queue.mjs` implements queue and worker behavior.
- `queue-ops.mjs` provides status, listing, recovery, cancellation, retry, and
  JSON export operations.
- `lib/enrichment-queue.test.mjs` covers the queue exit criteria.
- The v1-to-v2 migration is tested against a pre-existing SQLite file.

## Verification

Start-of-session baseline:

- `node --test`: 26/26 pass.
- Veneto Overture manifest parses successfully.
- Veneto Overture SHA-256 matches
  `fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230`.

Final verification:

- `node --test`: 27/27 pass.
- `git diff --check`: pass.
- Queue CLI status and expired-lease recovery smoke commands: pass.
- Brave requests: 0.
- Live crawls/searches: 0.

The restart test closes a queue with a leased job, advances beyond the lease,
opens the database again, recovers and reclaims the same job, rejects the stale
worker token, and atomically persists one website plus one resource. Other
tests simulate priority/concurrency, bounded retries, dead-letter recovery,
cancellation, atomic multi-scope budgets, circuit cooldown, manifests, UI
export, and graceful worker draining.

## Next bounded task

Session 9 should begin offline with the pinned Veneto Overture extract. Build a
reproducible importer that clips the rectangular extract to the exact Veneto
boundary and assigns accepted food candidates to ISTAT municipalities before
enqueueing any enrichment. Do not run a Veneto-wide crawl. A live stratified
pilot remains Session 10 work after the Brave reset and an explicit budget
check.
