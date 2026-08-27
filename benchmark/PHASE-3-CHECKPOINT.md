# Search recall recovery Phase 3 offline checkpoint

Date: 2026-08-27
Scope: Phase 3 only
Network requests: none
Session 8 scaling: not started

## Outcome

The scanner now accepts an operator-provided, municipality-bounded Overture
Places export through `OVERTURE_PLACES_PATH`. The local adapter reads GeoJSON,
JSON, or newline-delimited JSON exported from Overture GeoParquet; maps stable
place IDs, food taxonomy, names, geometry, structured address/postcode,
website, phone, confidence, and source references; and retains field-level
provenance. It fails closed on a missing bbox or a mismatched requested
municipality and rejects out-of-bbox, non-food, and address-contradictory rows.

The CLI no longer launches three generic town/category web searches on every
scan. Overture is disabled when no local extract is configured. Broad gap
discovery is also disabled by default and requires the explicit
`ENABLE_GAP_WEB_DISCOVERY=1` switch plus `LOCATION_POSTCODES`. Even then, the
Phase 3 replay-retained postcode restaurant template is the only template sent,
within the hard four-query source limit. Each enabled query reports its search
outcome, results, accepted candidates, and marginal accepted candidates.

PagineGialle remains disabled by default. The source register records that no
permission to republish its database is asserted and that opt-in is appropriate
only after the operator confirms a permitted route. No bypass or scrape was
added.

## Structured recall comparison

`node benchmark/evaluate-structured-recall.mjs` uses the frozen v2 truth set,
the frozen August 26 OSM scan, and an Overture-shaped deterministic adapter
fixture. The fixture is deliberately labelled as a replay assembled from
reviewed evidence; it is not claimed to be a downloaded current Overture
release snapshot.

| Combination | Truth venues | Recall | Duplicate truth IDs | Wrong/unlabelled admitted | Matching official domains |
| --- | ---: | ---: | --- | ---: | ---: |
| OSM | 42/45 | 93.33% | none | 0 | 3 |
| OSM + structured fixture | 43/45 | 95.56% | `ragazzon` | 0 | 4 |

The structured fixture adds the web-only Barhacca candidate with bbox geometry,
municipality, postcode, address, phone, official URL, stable ID, and provenance.
It reaches the candidate graph without any broad web call. Ragazzon exercises
and reports the expected cross-source duplicate. Three bad rows are rejected:
one non-food category, one outside the bbox, and one contradictory locality and
postcode.

Brave Place Search was not run because no supported API key/plan was configured
and this execution was required to remain deterministic and offline.

## Gap-query marginal yield

The offline replay tests three candidate templates after structured discovery:

| Template | Aligned/results | Marginal truth venues | Decision |
| --- | ---: | --- | --- |
| `"31046" ristorante menu` | 2/3 | `gellius` | retain |
| `"31046" pizzeria menu` | 1/2 | none | disable |
| `"Oderzo" "TV" ristorante menu` | 1/1 | none after prior query | disable |

The replay executes three queries, below the town ceiling of four. Production
enables only the retained template and only when an operator declares residual
gaps and supplies the postcode, so the normal town-level web-call count is zero
and the enabled count is one.

## Phase 3 exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| Web-only case reaches candidate graph without three generic searches | Barhacca is the one-venue marginal gain from the local structured fixture; broad discovery is disabled | Pass (adapter replay) |
| Every added candidate has explicit local evidence | Required point lies inside bbox; contradictory structured locality/postcode is rejected; evidence is retained in provenance | Pass |
| Web calls are bounded and marginal yield reported | Source hard cap is four; CLI retained-plan count is one; query-yield and benchmark marginal rows are emitted | Pass |
| OSM/structured duplicates and wrong categories measured | Ragazzon duplicate and all three rejected-input reasons are reported | Pass |
| PagineGialle permission handled safely | No permitted route is documented, so it remains disabled by default | Pass |

The adapter-replay qualifier matters: a real current Overture release must be
exported locally and benchmarked before claiming actual Overture coverage for
Oderzo. That live/dataset acquisition was intentionally not performed in this
offline phase execution.

## Offline verification

All deterministic commands completed successfully:

```text
node --test
  21 test files passed, 0 failed

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

node benchmark/evaluate-structured-recall.mjs
  OSM 42/45; OSM + structured fixture 43/45; one retained gap template
```

`git diff --check` also completed without errors. No live discovery, provider
call, national import/queue, cold-cache acceptance scan, or Session 8 command
was run.

## Dirty-worktree preservation

The starting status was captured before work and contained the substantial
modified and untracked Phase 0-2 and Session 2-7 work. Phase 3 adds only the
local structured-source adapter, bounded gap planner and instrumentation,
offline fixtures/evaluator/tests, source/schema integration, licensing entry,
and this report. Existing changes were not reset or overwritten.

No file under `benchmark/v1` was modified. Existing v2 truth and search-replay
fixtures were not rewritten. Phases 4-7 and Session 8 acceptance/scaling remain
unstarted.
