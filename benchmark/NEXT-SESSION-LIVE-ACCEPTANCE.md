# Next session: finish live acceptance, then decide whether scaling may begin

Date prepared: 2026-08-27
Current decision: **NO-GO pending live acceptance**
Primary town: Oderzo (TV)
Secondary smoke-test town: Sauris (UD)
Scaling: do not start until every step below passes

## Instruction for the next session

Execute this document from top to bottom. Continue through safe, narrowly
scoped fixes and repeat the affected acceptance runs when a gate fails. Do not
begin national importing, queue construction, or Session 8 scaling. Finish by
returning either:

- `GO — ready to archive the recovery plan and begin a separate scaling
  session`; or
- `NO-GO — remaining failures`, with exact evidence and the next required fix.

Preserve `benchmark/v1`, `benchmark/v2`, all checkpoint reports, and the dirty
worktree. Generated files under `output/` were deliberately cleared after this
handoff was written so the next live run starts from zero.

## 1. Read and verify the starting state

Read:

- `benchmark/archive/SEARCH-RECALL-RECOVERY-PLAN-COMPLETED-2026-08-27.md`
- `benchmark/PHASE-8-CHECKPOINT.md`
- `benchmark/LABELLING.md`
- `benchmark/v2/oderzo-truth.json`
- this file

Capture `git status --short`. Confirm that no scaling/import/queue process is
running and that `output/` contains no prior scans, cache, or evidence store.
Do not clean, reset, stage, or commit the dirty worktree.

Run the deterministic suite before making live requests:

```bash
node --test
node benchmark/evaluate.mjs
node benchmark/evaluate-enrichment.mjs
node benchmark/evaluate-websites.mjs
node benchmark/evaluate-resources.mjs
node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
node benchmark/evaluate-structured-recall.mjs
```

Also verify that the v1 aggregate fingerprint is still:

```text
bf953231e5ade8556efc4b9157ef01ac103885d0b43518b7c34220dc317a5f06
```

## 2. Confirm live prerequisites

Required:

- a supported Brave Web Search API key in `BRAVE_SEARCH_API_KEY`;
- a current, municipality-bounded Overture Places extract for Oderzo, reviewed
  for its bounding box, attribution, and source terms;
- permitted Nominatim/OSM access under the repository's configured policy;
- enough Brave quota for two cold scans, one warm scan, and one small-town
  smoke test.

The checked-in `benchmark/v2/overture-places-oderzo.geojson` is only an adapter
fixture. Do not present a run using it as a real Overture acceptance scan.

If a required key, licensed data extract, or permitted endpoint is unavailable,
stop with `NO-GO` rather than silently changing providers or using scraped
search HTML.

## 3. Create isolated run paths

Use absolute paths under a newly created temporary directory. Record the
directory in the final report. The two cold runs must use different search
caches, HTTP caches, and SQLite evidence stores. The warm run must reuse cold
run 2's three stores.

Example layout:

```text
<temp>/cold-1/search-cache
<temp>/cold-1/http-cache
<temp>/cold-1/evidence.sqlite
<temp>/cold-2/search-cache
<temp>/cold-2/http-cache
<temp>/cold-2/evidence.sqlite
```

Never use `output/.cache` for these acceptance runs. Never delete or overwrite
one cold run to make room for another.

## 4. Run Oderzo cold scan 1

Use:

```bash
OUTPUT_VARIANT=phase-8-cold-1 \
SEARCH_CACHE_DIR=<temp>/cold-1/search-cache \
CACHE_DIR=<temp>/cold-1/http-cache \
EVIDENCE_STORE_PATH=<temp>/cold-1/evidence.sqlite \
OVERTURE_PLACES_PATH=<absolute-current-oderzo-extract> \
ENABLE_GAP_WEB_DISCOVERY=1 \
LOCATION_POSTCODES=31046 \
TOP_N=100 \
node discover.mjs Oderzo TV
```

Save the generated scan. Confirm it contains `provider_manifest`, complete
search attempts, `acceptance_health`, request counts, cache status, source-run
health, elapsed time, schema/provenance data, and no raw third-party snippets in
published venue content.

## 5. Run Oderzo cold scan 2

Repeat with a different output variant and completely separate stores:

```bash
OUTPUT_VARIANT=phase-8-cold-2 \
SEARCH_CACHE_DIR=<temp>/cold-2/search-cache \
CACHE_DIR=<temp>/cold-2/http-cache \
EVIDENCE_STORE_PATH=<temp>/cold-2/evidence.sqlite \
OVERTURE_PLACES_PATH=<absolute-current-oderzo-extract> \
ENABLE_GAP_WEB_DISCOVERY=1 \
LOCATION_POSTCODES=31046 \
TOP_N=100 \
node discover.mjs Oderzo TV
```

Do not copy cold-1 caches into cold-2.

## 6. Run the warm Oderzo scan

Reuse cold-2's search cache, HTTP cache, and evidence store:

```bash
OUTPUT_VARIANT=phase-8-warm \
SEARCH_CACHE_DIR=<temp>/cold-2/search-cache \
CACHE_DIR=<temp>/cold-2/http-cache \
EVIDENCE_STORE_PATH=<temp>/cold-2/evidence.sqlite \
OVERTURE_PLACES_PATH=<absolute-current-oderzo-extract> \
ENABLE_GAP_WEB_DISCOVERY=1 \
LOCATION_POSTCODES=31046 \
TOP_N=100 \
node discover.mjs Oderzo TV
```

The warm publication set must match cold-2 while showing real cache/evidence
reuse. Investigate any accepted venue, official website, or resource that
appears or disappears only because the cache is warm.

## 7. Evaluate and manually review all three scans

Run the v2 evaluator separately against each scan:

```bash
node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json --scan oderzo=<cold-1-scan>
node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json --scan oderzo=<cold-2-scan>
node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json --scan oderzo=<warm-scan>
```

Manually review:

- every venue absent from the Phase 0 truth set;
- every newly accepted official site or resource;
- every known venue/site/resource missing from any run;
- Barhacca's venue, homepage, and order link;
- the single merged Giardinetto/Al Giardinetto record, official site, and menu;
- Pub Gatto Nero and the remaining web-only denominator;
- every review/rejection near a publication threshold;
- every hard negative from v1;
- every third resolver search and its escalation reason;
- every degraded/failed provider and any 429.

Update truth labels only from documented human evidence. Never change the truth
set merely to make a gate pass.

## 8. Build and run the live acceptance manifest

Copy `benchmark/v2/phase-8-acceptance.json` to a new live manifest. Change:

- `mode` to `live-isolated`;
- each run's `scan` to its actual scan path;
- the manual-review booleans to `true` only after review;
- transient-outage evidence if it was rerun;
- v1 integrity only after recomputing it.

Keep two runs marked `cold` and one marked `warm`. Then run:

```bash
node benchmark/evaluate-acceptance.mjs --manifest <live-manifest>
```

The evaluator must return `GO`. It must not be bypassed because individual
component fixtures pass.

If it returns `NO-GO`, diagnose the exact failed gates, make only narrowly
scoped corrections, rerun the deterministic suite, and repeat genuinely
affected cold/warm runs. Do not lower publication thresholds or edit fixtures
to hide failures.

## 9. Run the small-town smoke test

Use **Sauris (UD)** after Oderzo reaches `GO`. It is a deliberately small rural
case and already has v1 benchmark coverage, making it more useful than an
unlabelled random town.

Run one isolated cold scan with its own caches and evidence store. Use a real
Sauris-bounded structured extract if available; otherwise clearly report which
structured source was absent and treat this only as an OSM/provider smoke test.
Do not enable PagineGialle.

```bash
OUTPUT_VARIANT=phase-8-small-town \
SEARCH_CACHE_DIR=<temp>/sauris/search-cache \
CACHE_DIR=<temp>/sauris/http-cache \
EVIDENCE_STORE_PATH=<temp>/sauris/evidence.sqlite \
TOP_N=100 \
node discover.mjs Sauris UD
```

Evaluate it against v1:

```bash
node benchmark/evaluate.mjs --scan sauris-rural=<sauris-scan>
```

Manually inspect all rows because the old fixture is a regression set, not a
complete current truth census. Confirm that a small result set, zero-result
source, or degraded provider is reported honestly and does not crash or invent
venues.

## 10. Final decision, report, and archive rule

Write a final live acceptance report containing:

- exact scan paths and output variants;
- cache/evidence-store isolation paths;
- provider manifest and query attempts;
- elapsed time and all request counts;
- all release-gate metrics;
- manual additions/removals and evidence URLs;
- cold-to-cold differences and warm-cache differences;
- Sauris smoke-test findings;
- final v1 fingerprint and `git status --short` before/after.

Only when the live evaluator returns `GO` and the Sauris smoke test has no
unexplained correctness problem:

1. mark `benchmark/archive/SEARCH-RECALL-RECOVERY-PLAN-COMPLETED-2026-08-27.md` completed;
2. move it to a clearly named `benchmark/archive/` location or otherwise mark
   it archived, updating direct documentation links;
3. state that the repository is ready for a **separate Session 8 scaling
   session**;
4. stop—do not begin scaling in the acceptance session.

If any release gate remains red, leave the plan active and report `NO-GO`.
