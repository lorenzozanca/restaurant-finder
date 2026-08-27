# Search recall recovery Phase 6 offline checkpoint

Date: 2026-08-27
Scope: Phase 6 only
Network requests: none
Session 8 scaling: not started

## Outcome

Resource discovery and validation now have explicit, deterministic budgets.
Candidates are deduplicated, ranked, and preselected before network validation,
with one reserved slot per publishable role and a default ceiling of eight
validation requests. Final publication remains capped at six resources and is
also role-diverse. Accepted candidates excluded by the final cap are measured
rather than silently disappearing.

Sitemap discovery is sequential. A same-domain sitemap declared by the
accepted homepage is tried before common sitemap paths, discovery stops on the
first useful response, and at most two sitemap requests are made. If the
homepage and sitemap stage remain empty, exactly one combined domain-restricted
resource search is permitted. Website identity search counts remain separate
from this resource fallback.

HTTP text reads are capped at 512 KB (256 KB for sitemap XML). PDF and image
responses retain status, final URL, content type, content length, and
last-modified metadata without decoding their bodies into text. Cached GET
entries are versioned by the body ceiling so an older unbounded entry cannot be
mistaken for a bounded response.

Role classification now treats URL, anchor label, and nearby link evidence as
the strong signal. Page title, `h1`, canonical metadata, and JSON-LD are
extracted separately and can fill an otherwise unknown role, but page-wide
body vocabulary cannot override a strong role. Freshness uses explicit year
signals from URL/anchor/page/PDF metadata plus response `Last-Modified`.
Current and stable undated menus remain eligible; previous-year resources are
reviewed, and stale seasonal or older explicitly dated resources are rejected.

Each venue and the scan summary now report candidate, accepted, review,
rejected, pre-cap-dropped, and post-cap-dropped counts by role. The current scan
schema validates those counters and their totals.

## Deterministic fixtures and measured efficiency

The Phase 6 fixtures cover:

- 13 diverse candidates reduced to eight validation requests (38.5% fewer)
  while retaining the labelled menu, drinks, order, and specialty role set;
- two accepted candidates dropped only at the final publication cap and
  reported as `post_cap_dropped`;
- a declared sitemap succeeding in one request, without launching common
  sitemap variants or a search;
- two empty sequential sitemap attempts followed by exactly one
  domain-restricted search that retains the current menu;
- a strong menu anchor/URL remaining `menu` when page metadata contains
  specialty vocabulary;
- current, stable-undated, previous-year, and stale-seasonal freshness paths;
- bounded text reads and zero body decoding for a multi-megabyte PDF response.

## Exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| Session 7 precision does not regress | Frozen Session 7 evaluator remains 100% precise for every role with zero hard-negative publications | Pass |
| Known current menu/order links remain retained | Session 5 known-link replay remains 4/4; Session 7 role recall remains 100%; Phase 6 site-search fixture retains its current menu | Pass |
| Stale seasonal fixtures are review/rejected | Previous-year fixture is review; 2024 seasonal fixture is stale/rejected at the 2026 reference date | Pass |
| Validation count falls without labelled role loss | Phase 6 cap fixture validates 8/13 candidates and retains all four labelled roles | Pass |

## Offline verification

All required deterministic commands completed successfully:

```text
node --test
  24 test files passed, 0 failed

node benchmark/evaluate.mjs
  v1 evaluator completed; 0 unlabelled records; frozen metrics unchanged

node benchmark/evaluate-enrichment.mjs
  100% known-link recall; 100% search reduction in the Session 5 replay

node benchmark/evaluate-websites.mjs
  100% precision and recall in the Session 6 fixture

node benchmark/evaluate-resources.mjs
  100% precision and recall for every Session 7 role

node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
  frozen Phase 0 metrics unchanged; 0 unlabelled records

node benchmark/evaluate-structured-recall.mjs
  OSM 42/45; OSM + structured fixture 43/45; Phase 3 replay unchanged
```

`git diff --check` completed without errors. No live discovery, provider call,
cold-cache scan, national import/queue, or Session 8 command was run.

## Dirty-worktree and fixture preservation

`git status --short` was captured before implementation and again after final
verification. The pre-existing modified and untracked work remains present;
nothing was reset, cleaned, staged, committed, or overwritten. No write
targeted a file under `benchmark/v1`, and the v1 fixtures remain untracked and
unchanged. The Phase 6 implementation is limited to resource discovery,
bounded fetching, scan instrumentation/schema validation, deterministic tests,
and this checkpoint.

Phase 7 persistence and Phase 8 cold-cache acceptance/scaling were not started.
