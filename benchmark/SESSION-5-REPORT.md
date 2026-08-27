# Session 5 website-first enrichment report

Date: 2026-08-26

Session 5 reverses the enrichment order. A source-provided official website is
now fetched and inspected before any search request. When that crawl produces
a useful first-party menu, order, specialty, or menu-image link, enrichment
stops without searching. Search remains available when the known website is
missing, classified as non-official, unreachable, or reachable but contains no
useful resource.

Every venue now records a structured `enrichment_run` with crawl requests,
crawl-cache hits, search requests, the initial fallback reason, and one reason,
query kind, query text, and result count for every search invocation. The scan
contains an aggregate of the same request-budget facts. The enrichment version
is 9, so older saved results are not silently reused without this telemetry.

Homepage crawls use a canonical domain key, collapsing HTTP/HTTPS and `www`
aliases. Non-homepage URLs use their full canonical path, so two chain branches
do not accidentally share location-page content. Concurrent aliases also share
the same in-flight crawl promise.

## Offline comparison

The focused Session 5 fixture replays four labelled useful known websites from
the benchmark strata, including a branch location page. It makes no live
requests.

| Metric | Search-first minimum | Website-first |
| --- | ---: | ---: |
| Accepted labelled links | 4 | 4 |
| Link recall | 100% | 100% |
| Search requests | 4 | 0 |
| Search-request reduction | — | 100% |

This fixture specifically measures venues whose known websites already expose
useful resources, matching the Session 5 exit criterion. Missing or unhelpful
sites still exercise bounded identity, menu, and loose-identity fallbacks in
unit tests, with a reason attached to each request.

Verification:

```bash
node benchmark/evaluate-enrichment.mjs
node --test
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-4.json
git diff --check
```

The full offline suite passes. The Session 4 quality baseline remains unchanged:
100% venue precision, 100% official-website precision, 100% resource-role
precision, and the known Oderzo duplicate resolved.

Next bounded task: Session 6 should split identity, geography, officialness,
and confidence scoring and validate redirects, canonical URLs, structured
business data, contact facts, and branch/location evidence.
