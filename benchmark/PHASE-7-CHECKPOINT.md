# Search recall recovery Phase 7 offline checkpoint

Date: 2026-08-27
Scope: Phase 7 only
Network requests: none
Session 8 scaling: not started

## Outcome

A versioned SQLite evidence store now persists canonical venue identities,
aliases, source records, reversible merge edges, accepted website/resource
facts, review/rejection decisions, fact lifecycle events, search attempts, and
provider-health outcomes. The default database is municipality-scoped at
`output/<municipality>/evidence.sqlite`; deterministic runs can isolate it with
`EVIDENCE_STORE_PATH`.

Discovery no longer relies only on the current dated output filename. It
resolves durable identity in this order: canonical identifier, stable source
record, then an unambiguous normalized alias within the municipality. A rename
that retains a source record therefore reuses the same accepted facts. A
compatible same-day scan seeds an empty store so the previous resume behavior
is preserved without rewriting that scan.

Accepted facts record `first_seen`, `last_seen`, `last_checked`,
`valid_until`, `retry_after`, evidence version, and the last check outcome.
Published reused facts carry an explicit `evidence_state` with `current` or
`stale` freshness and `last_known_good` status. Scan-level counters report
reused, stale, and due-for-revalidation venues, and the scan schema validates
both the counters and fact audit metadata.

A transient provider failure, empty observation, or website timeout updates
check/retry state but cannot retire an accepted fact. A newly accepted official
website retires an older accepted website as positive contradictory evidence.
The explicit contradiction API requires a fact key and non-empty positive
evidence; confirmed closure likewise requires evidence and retires all active
facts. Resources dependent on a contradicted official site are retired with it.

Official-site resolver attempts now retain structured provider outcome,
provider attempts, HTTP/rate metadata, cache metadata, request ID, and errors
when available, allowing the evidence store to preserve provider health rather
than only the final result count.

## Deterministic transition fixtures

The Phase 7 fixtures cover:

- an accepted website followed by a simulated provider outage, remaining
  published first as current and later as visibly stale;
- a website crawl timeout, preserving the accepted site and recording
  `temporarily_unreachable` plus retry scheduling;
- `Giardinetto` renamed to `Al Giardinetto`, resolving through the unchanged
  source-record ID and reusing the accepted website across canonical aliases;
- a confirmed first-party closure retiring both the website and its dependent
  resource;
- an empty search observation not retiring a fact, followed by positive
  contradictory evidence that does retire it;
- SQLite schema/evidence version metadata and scan-schema validation of all
  durable audit fields.

## Exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| One-run provider outage cannot remove an accepted current site | Outage fixture returns the same accepted URL and records the failed check | Pass |
| Stale facts are visible and auditable | A 31-day replay remains last-known-good with `freshness: stale`, timestamps, validity, and retry metadata | Pass |
| Facts reuse across dates and aliases | Renamed-venue fixture resolves the prior durable venue through its stable source record | Pass |
| Positive contradiction can retire a fact | Explicit contradiction and confirmed-closure fixtures retire active facts with reasons and evidence events | Pass |

## Offline verification

All required deterministic commands completed successfully:

```text
node --test
  25 test files passed, 0 failed

node benchmark/evaluate.mjs
  v1 evaluator completed; 0 unlabelled records; frozen metrics unchanged

node benchmark/evaluate-enrichment.mjs
  100% known-link recall; 100% search reduction in the Session 5 replay

node benchmark/evaluate-websites.mjs
  100% precision and recall in the Session 6 fixture

node benchmark/evaluate-resources.mjs
  100% precision and recall for every Session 7 role; 0 hard negatives

node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
  frozen Phase 0 metrics unchanged; 0 unlabelled records

node benchmark/evaluate-structured-recall.mjs
  OSM 42/45; OSM + structured fixture 43/45; Phase 3 replay unchanged
```

`node --check discover.mjs` and `git diff --check` completed without errors.
No discovery command, provider call, cold-cache scan, warm acceptance scan,
national import, or queue/scaling command was run.

## Dirty-worktree and fixture preservation

`git status --short` was captured before implementation and again after final
verification. The same pre-existing modified and untracked work remains
present; nothing was reset, cleaned, staged, committed, or overwritten. Phase
7 added `lib/evidence-store.mjs`, its deterministic tests, the narrow discovery
and schema integration, structured resolver-attempt persistence, and this
checkpoint.

No write targeted `benchmark/v1`. Its final aggregate SHA-256 manifest
fingerprint is
`bf953231e5ade8556efc4b9157ef01ac103885d0b43518b7c34220dc317a5f06`.

Phase 8 cold-cache acceptance and national scaling were not started.
