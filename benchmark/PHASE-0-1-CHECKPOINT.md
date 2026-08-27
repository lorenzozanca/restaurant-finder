# Search recall recovery Phase 0 / Phase 1 offline checkpoint

Date: 2026-08-27
Scope: Phase 0 and the non-network portion of Phase 1
Network requests: none
Session 8 scaling: not started

## Outcome

The Oderzo acceptance denominator is frozen as benchmark v2. It contains 45
reviewed current venues: 42 OSM-backed canonical venues, Barhacca, Pub Gatto
Nero, and the live-review-only Gellius gap cited by the recovery plan. The
eight v1 hard negatives remain explicit negatives. The review found no rows
that needed a closed/unknown label; that category is represented separately
and is empty rather than being conflated with false candidates.

Every one of the 53 August 25 rows and 42 August 26 rows maps to a v2 current
venue or hard negative. The coverage test checks both historical files and
fails with the names of any unlabelled rows. No file under `benchmark/v1` was
modified.

The August 26 publication snapshot measures:

| Metric | Result | Initial gate |
| --- | ---: | ---: |
| Venue precision | 100.0% | >= 98% |
| Venue recall | 93.3% (42/45) | >= 90% |
| Structured venue recall | 100.0% (42/42) | reported by class |
| Web-only venue recall | 0.0% (0/3) | >= 85% |
| Official-site precision | 100.0% | >= 98% |
| Official-site recall | 37.5% (3/8) | >= 85% |
| Resource-role precision | 55.6% (5/9) | >= 95% |
| Current-resource recall | 55.6% (5/9) | >= 80% |
| Web-search requests | 120 | at least 50% below 120 |

The three venue false negatives are Barhacca, Gellius, and Pub Gatto Nero.
Barhacca and Al Giardinetto are current positive labels with their official
sites and current first-party order/menu resources. Al Giardinetto is present
as the OSM `Giardinetto` venue but its official site and menu are missing. The
resource-role result also makes the documented Ragazzon drift visible: its
menu page is published as `specialty`, its restaurant page as `order`, and two
old seasonal PDFs are unexpected publications.

## Frozen search replay

The four captured cache cases are stored in
`v2/search-replay/captured.json` with request purpose, location/identity input,
provider, transport/parser outcome, result set, and expected fidelity:

| Case | Provider | Expected outcome | Reason |
| --- | --- | --- | --- |
| targeted Barhacca | Brave | relevant | alias plus Oderzo evidence; official site is result 7 |
| targeted Giardinetto | Bing | irrelevant | namesakes lack Oderzo/postcode evidence |
| broad Oderzo discovery | Bing | irrelevant | generic/Rome results lack an Oderzo signal |
| PagineGialle domain query | Bing | irrelevant | zero returned hosts match `paginegialle.it` |

Synthetic offline replay also covers an empty response, 429 with rate headers,
timeout, parser change, and domain mismatch.

## Phase 1 contracts

`lib/search-client.mjs` defines a stable structured request and response, owns
provider fallback at the contract boundary, and preserves every attempt's
provider, HTTP status, transport/parser state, raw/relevant count, latency,
rate headers, and reason. `lib/search-health.mjs` classifies domain-constrained,
targeted venue, and broad discovery fidelity before candidate admission.

The legacy shell search is isolated behind a provider adapter. Existing
`search(query, limit, options)` callers still receive an array; callers that
need health and attempts use `searchDetailed()`. Legacy array cache entries are
wrapped as structured cache hits and classified, which makes the captured
PagineGialle/Bing entry `irrelevant` rather than a successful response. Only a
new `relevant` structured response is stored by this Phase 1 slice.

Scheduling, retry ownership, circuit breaking, provider-versioned cache keys,
isolated cache directories, supported Brave API integration, and live Place
Search remain Phase 2/3 work. No provider key was requested or used here.

## Verification

All commands completed successfully:

```text
node --test
  14 test files passed, 0 failed

node benchmark/evaluate.mjs
  v1 deterministic evaluator completed; 0 unlabelled records

node benchmark/evaluate-enrichment.mjs
  100% known-link recall; 100% search reduction in the Session 5 replay

node benchmark/evaluate-websites.mjs
  100% precision and recall in the Session 6 calibration fixture

node benchmark/evaluate-resources.mjs
  100% precision and recall for every Session 7 role

node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
  v2 metrics shown above; 0 unlabelled records
```

`git diff --check` completed without errors.

## Dirty-worktree preservation

The starting `git status --short` already contained substantial modified and
untracked work, including all existing benchmark v1 files. It was recorded
before implementation. This slice changed the already-modified
`lib/search.mjs` while preserving its pre-existing `throwOnError` behavior,
extended the already-untracked benchmark evaluator/README, and added only:

- `lib/search-client.mjs`, `lib/search-health.mjs`, and their test;
- `sources/search/legacy-script.mjs` and `sources/search/replay.mjs`;
- `benchmark/v2/*`, the v2 test, and this checkpoint.

The final status remains dirty by design. Existing unrelated modifications and
all v1 fixtures were left in place.
