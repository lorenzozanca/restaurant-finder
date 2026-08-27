# Phase 8 live acceptance report

Date: 2026-08-27
Decision: **GO — ready to archive the recovery plan and begin a separate scaling session**
Scaling: **not started**

## Acceptance result

`node benchmark/evaluate-acceptance.mjs --manifest benchmark/v2/phase-8-live-acceptance.json`
returned `GO`: 75 gates passed and 0 failed. Both cold runs and the warm run
had publication fingerprint
`875b1cbbae6bdf61636e4fb6331cdc57fed75f608afc6c4e7b770244bd7f39a4`.

Each run published 75 reviewed venues, 25 official sites, and 37 resources:
15 menus, 14 order/booking resources, 5 specialty pages, 2 drinks lists, and
1 menu image. Every release metric was 100%: venue precision/recall, web-only
venue recall, official-site precision/recall, overall resource-role
precision/recall, and precision/recall for every individual role. There were
no false positives, false negatives, unresolved duplicates, or unlabelled
rows. Barhacca and Giardinetto passed their explicit retention gates.

## Isolated runs

Temporary root: `/tmp/restaurant-finder-phase8-E2R3A7`

| Run | Scan | Stores | Elapsed | Counted requests |
| --- | --- | --- | ---: | --- |
| cold final 1 | `output/oderzo/2026-08-27.phase-8-cold-final-1.json` | `cold-final-1/search-cache`, `cold-final-1/http-cache`, `cold-final-1/evidence.sqlite` | 84,888 ms | 54 web searches, 62 crawls, 73 validations |
| cold final 2 | `output/oderzo/2026-08-27.phase-8-cold-final-2.json` | `cold-final-2/search-cache`, `cold-final-2/http-cache`, `cold-final-2/evidence.sqlite` | 78,261 ms | 54 web searches, 62 crawls, 73 validations |
| warm final | `output/oderzo/2026-08-27.phase-8-warm-final.json` | reused all three `cold-final-2` stores | 23,666 ms | 50 web searches, 33 crawls, 0 validations |

Privacy-redacted copies of all three qualifying scans are checked in under
`benchmark/v2/scans/live/`, and the live manifest uses those portable relative
paths. Search-result snippets are omitted; the telemetry required by the
acceptance evaluator is preserved.

The two cold publication sets were identical. The warm publication set was
also identical and recorded 28 search-cache hits. Empty and irrelevant search
outcomes deliberately have short or no persistent caching, so some warm
queries were retried; this did not affect publication.

In both cold manifests Brave recorded 65 logical/provider attempts: 38 fidelity
passes, 11 fidelity failures, 16 empty result sets, all HTTP 200. The warm
manifest recorded 51 logical/provider attempts: 28 passes, 11 failures, 12
empty sets, all represented with HTTP 200 outcomes. The full query strings,
purpose, escalation reason, cache state, timing, result counts, and per-provider
attempts are retained in each scan's `source_runs[*].search_attempts` and
`restaurants[*].enrichment_run`. No venue used a third resolver search, no 429
was observed, and no degraded provider was reported healthy.

OSM/Nominatim returned 44 records and the current Overture extract returned 54
in every qualifying Oderzo run. PagineGialle remained disabled. The reviewed
Overture file was
`/tmp/restaurant-finder-phase8-E2R3A7/overture-places-oderzo-2026-08-27.geojson`:
1,527 input records, bounded to Oderzo, with 54 publishable food venues after
category, confidence, address, and boundary checks. The extract was obtained
with the official Overture CLI and reviewed under Overture's source attribution
and CDLA Permissive 2.0/source-specific terms; the checked-in adapter fixture
was not used as live data.

## Manual review and corrections

The truth set is now version 2.1.0 with 75 current venues. Thirty additions
from the current Overture release were manually labelled from their stable
Overture IDs, food categories, confidence, municipality/postcode, geometry,
address/phone, and first-party URLs where present. The reasons and evidence are
recorded per venue in `benchmark/v2/oderzo-truth.json`. The review also added
newly confirmed official sites and current menu/order/drinks/specialty
resources; it did not label directories or editorial pages as official merely
to make the evaluator pass.

Safe fixes made during acceptance included current Overture schema/address
support, structured-source confidence/category filtering, municipality and
venue-type aliases, close-coordinate identity merging, complete search-attempt
telemetry, supported Brave search, directory/editorial domain rejection,
branch-specific resource identity, stable-page freshness handling, and a
bounded Overpass query that avoids the expensive optional `shop=ice_cream`
selector. Two preserved attempts (`phase-8-cold-1e` and `phase-8-cold-1f`)
honestly record the preceding Overpass 504 failure. No publication threshold
was lowered.

## Sauris smoke test

Final scan: `output/sauris/2026-08-27.phase-8-small-town-final-2.json`
Stores: `/tmp/restaurant-finder-phase8-E2R3A7/sauris-final-2/`
Elapsed: 14,259 ms

This was explicitly an OSM/provider smoke test because no current
Sauris-bounded Overture extract was available. It returned 15 OSM records and
14 merged venues, made 13 Brave provider attempts (all HTTP 200), and did not
crash or invent venues. All rows were manually inspected. Two official sites
were retained: Riglarhaus and Alla Pace. Riglarhaus had a current June 2026
menu-degustation page and its first-party booking/contact page; an external
booking engine remained unpublished in review. Three directory/portal domains
found during smoke review were blocked and the affected scan repeated.

The v1 Sauris evaluator still reports the absent `Fixture Rifugio Sauris` row.
That is expected: the v1 row uses a reserved `.example` domain and is explicitly
a synthetic regression fixture, not a complete current rural truth census.
The 14 live rows therefore remain unlabelled by v1 and were assessed manually,
as required by the runbook.

## Final verification and repository state

The final full test run passed 26/26 tests. All six deterministic evaluators
completed successfully, and the live acceptance evaluator again returned
`GO` with 75/75 gates. The v1 aggregate repository-path fingerprint remains
`bf953231e5ade8556efc4b9157ef01ac103885d0b43518b7c34220dc317a5f06`.

The dirty worktree recorded at the start was preserved. The final status still
contains the user's pre-existing modified/untracked work plus the Phase 8 files
and fixes; nothing was reset, cleaned, staged, or committed. No import, queue,
national scan, or other scaling process was started.
