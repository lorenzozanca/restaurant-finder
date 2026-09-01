# Session 9 report — Veneto offline importer slice

Date: 2026-08-27
Decision: **Veneto preparatory slice passes; national Session 9 remains in progress**
Live enrichment: **not started**

## Outcome

The pinned Overture Veneto rectangle can now be reproduced as an exact,
municipality-assigned offline candidate backbone. The importer streams the
342 MB GeoJSONSeq input, verifies both source checksums, filters supported
food-primary categories and confidence, assigns each point through exact ISTAT
polygons, canonicalizes within municipalities, persists source provenance, and
creates durable enrichment jobs without running a worker.

The full aggregate inventory is
`benchmark/VENETO-OFFLINE-INVENTORY-2026-08-27.json` with fingerprint:

`7a1f9c0827bb26a00331edda2959175471788d13bae22b2197b4203682156637`

## Pinned inputs

| Input | Version | SHA-256 |
| --- | --- | --- |
| Overture Places rectangle | release `2026-07-22.0`, schema `v1.18.0` | `fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230` |
| ISTAT non-generalized boundaries | geometry `2026-01-01`, EPSG:32632 source ZIP | `a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f` |
| Derived Veneto municipality GeoJSON | administrative identity through `2026-02-21`, EPSG:4326 | `355285130a22498786a1613ae76b93e1ccdbf12edd87be477f8271e33258e109` |

The source and derived geometry stay Git-ignored. Their tracked acquisition,
licensing, conversion, size, checksum, and attribution facts are in
`data/istat/2026-01-01/veneto-boundaries.manifest.json`.

ISTAT's available geometry is referenced to 1 January 2026. The municipality
register changed on 21 February when Castegnero and Nanto merged into current
municipality `024129 Castegnero Nanto`. The converter applies that official
crosswalk explicitly, preserving both predecessor polygons as one multipolygon.
The final layer therefore has 559 current Veneto municipalities rather than
silently assigning July records to two obsolete identities.

## Inventory

| Metric | Result |
| --- | ---: |
| Rectangle input records | 287,081 |
| Accepted, exact-region source records | 13,113 |
| Canonical venue candidates | 13,073 |
| Collapsed duplicate source records | 40 |
| Municipalities with candidates | 552 / 559 |
| Candidates with source websites | 7,573 (57.93%) |
| Queued enrichment jobs | 13,073 |
| Worker attempts | 0 |

Candidate types are 6,228 restaurants, 2,595 bars, 2,081 pizzerias, 1,523
cafes, 346 pubs, 166 ice-cream venues, and 134 fast-food venues.

The importer quarantined or rejected 273,968 rectangle records: 256,877
non-food-primary records, 11,066 below the confidence gate, 5,957 outside the
exact Veneto municipalities, 57 outside the combined Veneto envelope, nine
address contradictions, and two points exactly ambiguous on municipality
boundaries. None became a venue or job.

Oderzo independently reproduces 54 accepted Overture source records, matching
the count in the Phase 8 live acceptance run. Current Castegnero Nanto has seven
candidates; neither obsolete predecessor code appears in queue payloads.

## Assignment and durability checks

- Polygon, multipolygon, hole, island, external boundary, shared boundary, and
  post-merger internal-boundary behavior has deterministic tests.
- A local independent centroid audit assigned all 558 available Veneto samples
  correctly after applying the official two-to-one merger crosswalk. The two
  pre-merger rows without coordinates were not counted as samples.
- The durable SQLite integrity check returns `ok`.
- The store contains 13,073 venues and exactly 13,073 jobs, all `queued`.
- The import manifest is `completed`; the attempts table is empty.
- Repeated fixture imports preserve the same fingerprint, run, venue rows, and
  job rows.
- `node --test` passes 30/30 test files and `git diff --check` passes.
- All three pinned/derived checksums match their manifests; all JSON manifests
  parse successfully.
- Brave requests, live searches, crawls, and worker attempts: zero.

The first real scale pass exposed and fixed an unsafe alias-only fallback in
the evidence store: distinct same-name venues in one municipality could resolve
to the first durable row. Durable resolution now requires a stable canonical or
source-record identifier. A regression test preserves distinct same-name
venues, and the rebuilt real store has a one-to-one canonical venue/job count.

## Reproduction

After downloading and extracting the pinned ISTAT archive:

```bash
node prepare-istat-boundaries.mjs \
  --source-directory data/istat/2026-01-01/source \
  --archive-path data/istat/2026-01-01/source/Limiti01012026.zip \
  --expected-archive-sha256 a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f \
  --region-code 5 \
  --changes-path data/istat/2026-01-01/administrative-changes-through-2026-02-21.json \
  --output-path data/istat/2026-01-01/derived/veneto-municipalities.geojson

node import-region.mjs \
  --overture-manifest data/overture/2026-07-22.0/veneto-places-bbox.manifest.json \
  --boundary-manifest data/istat/2026-01-01/veneto-boundaries.manifest.json \
  --store data/istat/2026-01-01/derived/veneto-import.sqlite \
  --report benchmark/VENETO-OFFLINE-INVENTORY-2026-08-27.json
```

The second command is idempotent for the same source/boundary/scoring revision.
It only creates queued work; it does not start enrichment.

## Next bounded task

Session 9 is not yet a national import: the available Overture file covers only
Veneto. Before Session 10, either acquire and pin the intended national
candidate source or explicitly scope the pilot to a stratified, manually
reviewed subset of these queued Veneto candidates. Do not start the 13,073-job
queue. The live pilot still requires a Brave reset/budget check, explicit worker
limits, and sampling rather than a regional crawl.
