# Session 4 canonical identity report

Date: 2026-08-26

Session 4 adds a deterministic identity layer before enrichment. Each output
venue now has a canonical ID, aliases, immutable source-record summaries, and
merge audit entries that name both source records and the evidence used. The
schema validator verifies those references so a merge can be traced and
reversed later.

Merges require independent corroboration. Exact or prefix-normalized names do
not merge by themselves; accepted evidence can include a matching canonical
website, phone, address, or nearby coordinates. A distance conflict over one
kilometre blocks a merge, including same-domain chain locations. Unit fixtures
cover Ca'Lozzio's OSM node/way pair, Giardinetto/Al Giardinetto,
Dussin/Ristorante Locanda Dussin, uncorroborated same names, and distant chain
branches.

The Session 4 benchmark is an offline frozen identity snapshot. No provider
requests were made.

| Metric | After Session 2 | After Session 4 |
| --- | ---: | ---: |
| Venue admission precision | 100.0% | 100.0% |
| Venue admission recall | 75.0% | 75.0% |
| Official website precision | 88.9% | 100.0% |
| Resource-role precision | 100.0% | 100.0% |
| Resolved duplicate groups | 0/1 | **1/1** |
| Unresolved duplicate groups | 1 | **0** |

The website precision change comes from collapsing the HTTP/HTTPS Ca'Lozzio
source records and retaining the stronger HTTPS fact. The three known coverage
misses—Giardinetto, Locanda Dussin, and Gli Ingordi—remain false negatives in
the frozen admission output. The identity module merges the first two alias
pairs when both source records are present and corroborated; it does not invent
missing source records.

Verification:

```bash
node --test
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-4.json
git diff --check
```

Next bounded task: Session 5 should make enrichment website-first and measure
search invocations and fallback reasons against the benchmark.
