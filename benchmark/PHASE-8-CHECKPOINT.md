# Search recall recovery Phase 8 checkpoint

Date: 2026-08-27
Scope: Phase 8 acceptance and rollout decision only
Network requests: none
Session 8 scaling: not started

## Outcome: NO-GO

Phase 8 was executed under the required deterministic-offline constraint. It
does **not** authorize rollout. The checked-in acceptance manifest replays the
immutable August 26 scan in two cold diagnostic roles and one warm diagnostic
role so the gate calculation itself is repeatable. These are not represented
as live scans, and the evaluator refuses to turn an offline replay into a
release decision.

The frozen scan still has 93.33% venue recall and 100% venue precision, but it
has 0% web-only venue recall, 37.5% official-website recall, 55.56% resource
role precision, and 55.56% known-resource recall. It also predates the Phase
1-7 audit fields and recorded 120 web searches, so it cannot demonstrate the
provider, scheduler, cache, or efficiency gates. Barhacca is absent and
Giardinetto lacks its accepted official site and current menu.

The separate Phase 3 adapter replay improves venue recall to 43/45 (95.56%)
without wrong admissions; its retained postcode query adds Gellius. Even when
those independent results are considered, web-only recall is only 2/3
(66.67%), below the 85% gate because Pub Gatto Nero is still missing. Adapter
and scorer fixtures cannot establish end-to-end website/resource recall or
live provider durability.

## Acceptance tooling

`benchmark/evaluate-acceptance.mjs` evaluates every release gate together and
returns a non-zero exit code on `NO-GO`. It requires:

- two passing `cold` scans and a passing `warm` scan;
- a `live-isolated` manifest, isolated output variants, and cache reuse without
  a publication-set change;
- precision/recall gates against the v2 Oderzo truth set;
- complete search-attempt/provider/cache/latency/purpose audit data;
- query budgets, provider yield, scheduler health, elapsed time, schema and
  provenance validation;
- manual review of every new acceptance and lost known fact;
- the simulated-outage result and the v1 fixture fingerprint.

Discovery outputs now retain town-search attempts, a provider manifest,
acceptance-health counters, and elapsed time so a real Phase 8 manifest can be
evaluated without reconstructing telemetry from logs. Search attempts from
degraded sources remain attached to the degraded source run.

The deterministic diagnostic is:

```bash
node benchmark/evaluate-acceptance.mjs
```

Its expected result is `NO-GO`; that exit status is an acceptance result, not a
test-suite failure.

## Operator acceptance still required

Before archiving the plan or starting Session 8 scaling, an operator should run
two real cold-cache scans and one warm scan with a supported Brave API key and
a reviewed, current municipality-bounded Overture extract. Use distinct output
variants, search caches, general caches, and evidence stores for each cold run;
reuse the second cold run's caches for the warm run. Do not point any of these
paths at the historical August 25/26 evidence.

Example isolation pattern (replace the Overture path with a real reviewed
extract and keep the Brave key in the environment):

```bash
OUTPUT_VARIANT=phase-8-cold-1 SEARCH_CACHE_DIR=/tmp/restaurant-finder-phase8-search-cold-1 CACHE_DIR=/tmp/restaurant-finder-phase8-http-cold-1 EVIDENCE_STORE_PATH=/tmp/restaurant-finder-phase8-evidence-cold-1.sqlite OVERTURE_PLACES_PATH=/path/to/reviewed-oderzo.geojson ENABLE_GAP_WEB_DISCOVERY=1 LOCATION_POSTCODES=31046 TOP_N=100 node discover.mjs Oderzo TV

OUTPUT_VARIANT=phase-8-cold-2 SEARCH_CACHE_DIR=/tmp/restaurant-finder-phase8-search-cold-2 CACHE_DIR=/tmp/restaurant-finder-phase8-http-cold-2 EVIDENCE_STORE_PATH=/tmp/restaurant-finder-phase8-evidence-cold-2.sqlite OVERTURE_PLACES_PATH=/path/to/reviewed-oderzo.geojson ENABLE_GAP_WEB_DISCOVERY=1 LOCATION_POSTCODES=31046 TOP_N=100 node discover.mjs Oderzo TV

OUTPUT_VARIANT=phase-8-warm SEARCH_CACHE_DIR=/tmp/restaurant-finder-phase8-search-cold-2 CACHE_DIR=/tmp/restaurant-finder-phase8-http-cold-2 EVIDENCE_STORE_PATH=/tmp/restaurant-finder-phase8-evidence-cold-2.sqlite OVERTURE_PLACES_PATH=/path/to/reviewed-oderzo.geojson ENABLE_GAP_WEB_DISCOVERY=1 LOCATION_POSTCODES=31046 TOP_N=100 node discover.mjs Oderzo TV
```

After manual review, create a manifest based on
`benchmark/v2/phase-8-acceptance.json`, change `mode` to `live-isolated`, point
the three run entries at the new files, record both manual-review booleans, and
run:

```bash
node benchmark/evaluate-acceptance.mjs --manifest /path/to/live-phase-8-manifest.json
```

Archive `archive/SEARCH-RECALL-RECOVERY-PLAN-COMPLETED-2026-08-27.md` and move to scaling only if that command
returns `GO`. On the current evidence the plan remains active at its final gate.

## Deterministic verification

The Phase 8 evaluator unit tests, the full Node test suite, all required v1/v2
evaluators, syntax checks, and whitespace checks were run offline. The final
command results are recorded in the handoff for this checkpoint.

## Dirty worktree and fixtures

`git status --short` was captured before Phase 8 and after verification. The
pre-existing modified and untracked work was preserved; nothing was reset,
cleaned, staged, committed, or overwritten. No historical August 25/26 output
was written.

No file under `benchmark/v1` was modified. Its aggregate SHA-256 manifest
fingerprint remains
`bf953231e5ade8556efc4b9157ef01ac103885d0b43518b7c34220dc317a5f06`.

Session 8 import, queue, and national-scaling work was not started.
