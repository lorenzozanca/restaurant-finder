# Oderzo scan comparison and Italy-scale assessment

Date: 2026-08-25

## Executive conclusion

The latest scan is **not the best overall**, so no older Oderzo files were
deleted.

The 2026-08-25 run materially improves resource-enrichment coverage, result
classification, and elapsed time over the original 2026-08-24 run. However,
discovery precision regressed compared with the `2026-08-24.perf-after.json`
snapshot: 8 of the latest scan's 10 web-only records are evident false
positives, three useful web records disappeared, and one clear OSM node/way
duplicate remains. The latest file is therefore useful evidence of enrichment
progress, but it should not replace the older baselines.

The current infrastructure is suitable for interactive town-level scans and a
small controlled pilot. It is **not suitable as-is for systematically scanning
all 7,894 municipalities in the bundled ISTAT list**. Italy-wide discovery
should be rebuilt around one regional/national OSM extract and a persistent,
resumable enrichment queue rather than thousands of public Nominatim and
Overpass calls.

## Files compared

- `output/oderzo/2026-08-24.json`: original baseline
- `output/oderzo/2026-08-24.after-relevance.json`: stricter resource relevance
- `output/oderzo/2026-08-24.perf-after.json`: current discovery shape and
  stricter enrichment, before the latest scan
- `output/oderzo/2026-08-25.json`: latest scan
- The dated `.log.json` files were used for elapsed time and source counts.

These snapshots were produced under different code/configuration states, so
the comparison is an operational regression check, not a controlled A/B test.

## Quantitative comparison

| Metric | 2026-08-24 original | 2026-08-24 relevance | 2026-08-24 perf | 2026-08-25 latest |
| --- | ---: | ---: | ---: | ---: |
| Rows | 61 | 59 | 48 | 53 |
| Rows resource-checked | 20 (32.8%) | 20 (33.9%) | 20 (41.7%) | **53 (100%)** |
| Rows with resources | 20 | 12 | 10 | **16** |
| Resource links | 284 unclassified | 33 | 31 | **48** |
| High-confidence resource links | n/a | 27 | 25 | **43** |
| Official websites | n/a | 11 | 11 | **15 reported** |
| Rows with coordinates | 60 | 58 | 43 | 43 |
| Rows with addresses | 61 | 59 | 19 | 21 |
| Rows with phone numbers | 16 | 15 | 14 | 16 |
| Logged elapsed time | 142.88 s | n/a | n/a | **103.95 s** |

The logged run became about 27% faster while checking 53 rather than 20 rows.
That is a strong throughput improvement, although the shared 24-hour cache and
different snapshots mean it is not a clean cold-run benchmark.

## What improved

1. **Full enrichment coverage.** Every latest row has
   `resources_checked: true`; earlier snapshots checked only 20 rows.
2. **Resource quality metadata.** The original 284 links had no role or
   confidence. The latest scan limits the result to 48 classified links: 43
   high-confidence and 5 medium-confidence.
3. **More surfaced resources.** Reported official sites rose from 11 to 15 and
   resource-bearing rows from 10 to 16 versus the performance snapshot.
4. **Better runtime.** The dated logs end at 103.95 seconds versus 142.88
   seconds for the original dated run.
5. **Source/legal metadata.** The latest output includes OSM attribution, which
   the original and relevance snapshots lacked.

## What regressed

### Web discovery precision

The performance snapshot had five web-search records, all plausible Oderzo
businesses: Al Giardinetto, Barhacca, Gli Ingordi, Pub Gatto Nero, and
Ristorante Locanda Dussin.

The latest scan has ten web-search records. Barhacca and Pub Gatto Nero are the
two plausible retained records. The other eight are false positives in the
captured evidence:

| Latest record | Evidence of mismatch |
| --- | --- |
| BdueB | URL is `trattoriamilano.com`; the captured title identifies Trattoria La Fornasetta, not BdueB or Oderzo. |
| Cercare Vicino A Me | Generic “trattorie e osterie vicino a me” directory page. |
| Contributori Ai Progetti Wikimedia | Wikimedia boilerplate was parsed as a restaurant name. |
| Milano Pocket | URL is a list of the best trattorie in Milan. |
| Roma Pop | URL is a list of trattorie in Rome. |
| San Filippo Neri | Captured result describes Milanese cuisine and provides no Oderzo evidence. |
| Scatti Di Gusto | URL and title are a list of 35 trattorie in Milan. |
| Trattoria Contemporanea | Captured title explicitly locates it in Lomazzo, Como. |

This makes the latest web-discovery precision 2/10 (20%) on obvious local
relevance, compared with 5/5 for the performance snapshot. Those false records
also account for 21 of the latest file's 48 resource links and at least seven
of its 15 reported official websites. Consequently the headline enrichment
gains overstate useful Oderzo coverage.

The main mechanism is visible in `sources/web-search.mjs`: discovery accepts
search results without requiring positive town/province evidence, and
`extractItalianAddress()` appends the requested town to any street address it
extracts. This produced fabricated combinations such as Milan/Rome street
addresses followed by `Oderzo`.

### Coverage losses and deduplication

Compared with the performance snapshot, the latest scan dropped Al
Giardinetto, Gli Ingordi, and Ristorante Locanda Dussin. Giardinetto and Dussin
still exist as OSM rows, but their official-site enrichment was not merged into
those rows; Gli Ingordi is absent entirely.

The latest result also contains both `Ca' Lozzio` (OSM way) and `Ca'Lozzio`
(OSM node), at the same address and about 6 metres apart, with the same website.
Exact normalized-name deduplication does not handle punctuation/spacing plus
node/way duplicates robustly enough.

### Source health reporting

The latest log records zero PagineGialle results, but `sources_used` still lists
`paginegialle`. The schema currently reports enabled sources, not successful
sources, which would hide partial-source failures during a national run.

## Deletion decision

**No files were deleted.** The user's deletion condition was “if the latest
scan was the best.” It was not met. In particular:

- keep `2026-08-24.perf-after.json` as the strongest discovery-precision
  baseline;
- keep `2026-08-24.after-relevance.json` to measure the relevance-filter
  transition;
- keep `2026-08-24.json` and its log until the normal retention policy expires,
  because they provide the only direct before/after timing baseline;
- keep the latest scan and log as the full-enrichment regression fixture.

## Can this scan all of Italy?

### Short answer

Not safely or reliably in its present town-at-a-time form.

The bundled ISTAT picker contains 7,894 municipalities. At the latest warm-run
time of 103.95 seconds per municipality, a single sequential pass would take
about **9.5 continuous days**. This is an optimistic lower-bound extrapolation:
large cities, cold caches, timeouts, retries, and search-provider throttling
will increase it. The latest Oderzo output plus log is about 42.5 KB, so the
final per-town JSON/log layer alone would be roughly 335 MB if towns were
similar; fetched-page/search caches and large-city outputs would dominate that
estimate.

More importantly, the request pattern is wrong for national extraction:

- one public Nominatim town lookup and one public Overpass query per
  municipality means about 7,894 calls to each service;
- web discovery issues three generic searches per town, PagineGialle adds up
  to three more, and resource enrichment can issue one to three searches per
  venue;
- four venue workers run concurrently, while search starts are only spaced one
  second apart in one process;
- there is no durable job queue, checkpoint/retry state, global rate budget,
  source circuit breaker, run manifest, or quality gate;
- town-by-town web results cause cross-city pollution and repeated discovery;
- the public Nominatim policy forbids systematic queries used to obtain
  complete lists/POIs and directs complete-set users to OSM extracts;
- public Overpass instances are best-effort infrastructure intended for smaller
  workloads, not a production SLA.

Official references:

- Nominatim usage policy: <https://operations.osmfoundation.org/policies/nominatim/>
- Overpass API/public-instance guidance: <https://wiki.openstreetmap.org/wiki/Overpass_API>
- Current Italy OSM extract: <https://download.geofabrik.de/europe/italy.html>

As of this report, Geofabrik's Italy PBF is about 2.1 GB, a practical size for
an offline national discovery job.

### Recommended production shape

1. **Discover nationally from an extract.** Download the Italy OSM PBF once,
   filter the supported amenity/shop tags with Osmium or an equivalent tool,
   and spatially assign venues to municipality boundaries. Apply replication
   diffs for refreshes instead of rescanning every town.
2. **Use stable identities.** Key OSM records by type/id, collapse node/way
   duplicates using distance, normalized name, address, phone, and canonical
   domain, and maintain alias mappings across refreshes.
3. **Make web discovery evidence-based.** Require explicit municipality,
   province, postcode, or coordinate evidence before admitting a web-only
   venue. Never append the requested town to an unverified extracted street.
   Reject list/editorial/generic pages before fetching or enriching them.
4. **Separate discovery from enrichment.** Put unique venues into a persistent
   queue. Enrich official sites once per canonical venue/domain, with bounded
   retries, exponential backoff, per-host limits, and resumable checkpoints.
5. **Treat search as optional enrichment.** Record the actual provider and
   contract, budget queries globally, cache by canonical venue rather than town,
   and do not let provider failure erase the OSM baseline.
6. **Add measurable gates.** Store source status, request counts, duration,
   rejection reasons, duplicate counts, precision samples, and versioned run
   manifests. Block publication when a source fails or sampled precision falls
   below an agreed threshold.
7. **Complete compliance work before publication.** Preserve OSM attribution
   and assess ODbL database obligations; resolve search-provider and
   PagineGialle storage/redistribution terms; complete the controller, lawful
   basis, notice, processor, and retention gates already identified in
   `DATA-LICENSING.md` and `PRIVACY.md`.

### Sensible rollout

After fixing the precision and deduplication defects, run a stratified pilot
covering small, medium, and large municipalities across multiple regions.
Manually label a sample for precision/recall, measure cold-cache cost and
provider error rates, and size the queue from those measurements. Proceed to a
national run only after the pilot meets explicit quality, cost, service-policy,
and compliance gates.

## Verification performed

- Parsed all four result snapshots and both dated logs.
- Compared source distributions, field completeness, resource roles and
  confidence, added/removed records, and nearby OSM objects.
- Inspected cached search evidence for the latest web-only additions.
- Reviewed discovery, enrichment, caching, retention, licensing, and privacy
  code/documentation.
- Ran `node --test`: 5 tests passed, 0 failed.
