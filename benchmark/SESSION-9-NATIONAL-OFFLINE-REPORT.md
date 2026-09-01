# Session 9 report — national offline candidate import

Date: 2026-08-28
Decision: **Session 9 complete; ready for bounded Session 10 pilot planning**
Live enrichment: **not started**

## Outcome

The pinned Overture Places release and national ISTAT boundary layer now form a
reproducible offline Italy candidate backbone. The importer verified both
checksums, streamed 3.1 million raw records, applied food-primary and confidence
gates, assigned accepted points through exact municipality polygons,
canonicalized identities, persisted provenance, and created durable jobs
without starting a worker.

The aggregate inventory is
`benchmark/ITALY-OFFLINE-INVENTORY-2026-08-28.json`, fingerprint:

`6304b94a64aac43775e2715114b98166032c51bfedd03dd31642684b08a11a2b`

## Pinned inputs

| Input | Version | SHA-256 |
| --- | --- | --- |
| Overture Places Italy envelope | release `2026-07-22.0`, schema `v1.18.0` | `39d433dcfba6d0705b1d9092eac44f1766d213566b23f02e41c53c0204cb8c3c` |
| ISTAT non-generalized archive | geometry `2026-01-01` | `a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f` |
| Derived national municipalities | administrative identity through `2026-02-21` | `b6514449818f13c3252492c1b85f35701523b269fd9d4e192ea7d06f568f0783` |

The Overture extract is 3,676,409,954 bytes with 3,100,760 GeoJSONSeq
records. The derived boundary layer contains 7,895 current municipalities in
all 20 regions. Large raw, derived, and SQLite files remain Git-ignored; their
manifests are tracked.

## National inventory

| Metric | Result |
| --- | ---: |
| Raw input records | 3,100,760 |
| Accepted source records | 156,740 |
| Canonical venue candidates | 156,057 |
| Collapsed duplicate source records | 683 |
| Municipalities with candidates | 7,398 / 7,895 |
| Candidates with source websites | 86,852 (55.65%) |
| Queued enrichment jobs | 156,057 |
| Worker attempts | 0 |

Candidate types are 74,492 restaurants, 29,519 bars, 22,153 cafes, 21,890
pizzerias, 4,307 pubs, 1,940 fast-food venues, and 1,756 ice-cream venues.

The importer rejected or quarantined 2,944,020 records: 2,772,952 non-food
primary records, 145,589 below the confidence gate, 25,423 address
contradictions, 46 outside exact Italian municipalities, eight boundary
ambiguities, and two outside the national envelope.

## Scaling defects found and fixed

One valid Overture URL contained a literal U+2028 Unicode line separator.
Node's `readline` treated it as a record boundary even though GeoJSONSeq is
delimited by LF bytes. The importer now uses an LF-only streaming parser, and a
regression test preserves the real case.

The first national attempt also exposed quadratic identity work for unrelated
venue names inside large municipalities. A behavior-preserving prefilter now
skips expensive comparisons unless the pair can satisfy the existing name or
strong phone-plus-website/address gates. The complete Veneto inventory retained
its exact pre-optimization fingerprint, 13,073 canonical venues, and 40
duplicate collapses before the national run was accepted.

## Durability and safety checks

- SQLite `PRAGMA integrity_check` returns `ok`.
- The store contains 156,057 venues and exactly 156,057 queued jobs.
- The run manifest is `completed`.
- The attempts table and terminal-job count are both zero.
- All 20 regional inventory rows are present.
- Source and boundary checksums match their tracked manifests.
- The deterministic suite passes 30/30 test files.
- Brave requests, live searches, crawls, and worker attempts: zero.
- Disk space after download, import, and reports: approximately 188 GiB free.

## Next bounded task

Session 10 should select and manually review a small stratified national queue
subset. Do not execute it until the Brave monthly reset and current allowance
are confirmed and explicit worker, provider, domain, and request limits are
recorded. Do not start either complete regional or national queue wholesale.
