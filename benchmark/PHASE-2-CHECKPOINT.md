# Search recall recovery Phase 2 offline checkpoint

Date: 2026-08-27
Scope: Phase 2 only
Network requests: none
Session 8 scaling: not started

## Outcome

Search scheduling now belongs to a provider wrapper. A provider has its own
one-RPS launch queue, concurrency limit, retry loop, reset-header/backoff
policy, request budget, and circuit breaker. Retries pass through the same
queue as first attempts, and every physical attempt remains visible in the
structured search response. Deterministic fake-clock tests cover concurrent
requests, a 429 retry, reset waiting, fallback, the circuit breaker, and budget
exhaustion without sleeping or accessing the network.

Production search no longer invokes the multi-engine scraped-HTML script. The
default adapter is the supported Brave Web Search JSON endpoint and requires
`BRAVE_SEARCH_API_KEY`. The legacy script remains available only when
`SEARCH_DIAGNOSTIC_LEGACY=1` is explicitly set; its engine is pinned rather
than silently falling through to Bing. This phase did not use or request an API
key.

Search cache entries use the `search-response-v2` namespace and include the
provider/endpoint version, normalized query, locale, country, limit, purpose,
location, identity, requested domain, and fidelity-scorer version. Relevant
responses use the normal 24-hour TTL. Rate limits, provider failures, and
budget exhaustion use a five-second storm-prevention TTL. Irrelevant responses
are not stored. `SEARCH_CACHE_DIR` selects an isolated search cache, and an
offline test proves that two cache directories do not share entries.

Source runs now distinguish `degraded` from `succeeded` and record
`useful_result_count`, search outcomes, and a reason. PagineGialle is disabled
by default pending permission review; when explicitly enabled, zero
matching-domain results are degraded. An offline provider-outage fixture proves
that web discovery cannot report success. The scan schema accepts and validates
the new health state and bounded useful count.

## Phase 2 exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| No overlapping calls at one RPS, including retries | Fake-clock concurrent/retry scheduler test; maximum active calls is one and every launch is at least 1,000 ms apart | Pass |
| Irrelevant response cannot poison another provider cache | Provider/version cache-key and no-store test | Pass |
| PagineGialle zero domain matches are degraded | Three-query offline mismatch fixture | Pass |
| Provider outage cannot claim success | Three-query offline outage fixture | Pass |
| Scraped Bing is absent from production fallback | Default-provider test selects only `brave_web_api`; legacy Bing requires diagnostic configuration | Pass |

## Offline verification

All required deterministic commands completed successfully:

```text
node --test
  18 test files passed, 0 failed

node benchmark/evaluate.mjs
  v1 evaluator completed; 0 unlabelled records

node benchmark/evaluate-enrichment.mjs
  100% known-link recall; 100% search reduction in the Session 5 replay

node benchmark/evaluate-websites.mjs
  100% precision and recall in the Session 6 fixture

node benchmark/evaluate-resources.mjs
  100% precision and recall for every Session 7 role

node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
  frozen Phase 0 metrics unchanged; 0 unlabelled records
```

`git diff --check` also completed without errors. No live discovery command,
cold-cache acceptance scan, or scaling/import command was run.

## Dirty-worktree preservation

The starting status contained the substantial modified and untracked work
listed in the Phase 0/1 checkpoint, including all benchmark fixtures. The
ending status remains dirty by design. Phase 2 modified the existing search,
cache, source-health, source adapter, schema, discovery, licensing, and test
files needed by this phase, and added the scheduler, Brave API adapter, cache
and scheduling tests, PagineGialle health test, and this report.

No file under `benchmark/v1` was modified. The frozen v2 truth set and replay
fixtures were not rewritten. Phase 3 structured recall, Phases 4-7, and Session
8 acceptance/scaling remain unstarted.
