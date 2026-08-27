# Italy-wide web enrichment: architecture note and session plan

Status: active — Sessions 1–7 complete; live acceptance GO; scaling not started
Created: 2026-08-26
Evidence base: `ODERZO-SCAN-REPORT.md`

Next-session handoff: [`NEXT-SCALING-SESSION.md`](NEXT-SCALING-SESSION.md)

## Purpose

The long-term product is not merely a national list of restaurants. The useful
part is a trustworthy, refreshable index of each venue's official website and
its menu, ordering, drinks, specialty, PDF, and menu-image links.

OpenStreetMap should provide a cheap national candidate and identity backbone.
Web crawling and search should provide the valuable enrichment. OSM is not
expected to contain the menu links: in the latest Oderzo scan it supplied
website tags for six OSM objects representing five unique businesses, but none
of the 48 resource links existed in OSM.

The immediate constraint is correctness, not raw throughput. The latest Oderzo
scan fully enriched every row and ran faster, but eight of ten web-discovered
venue rows were clear false positives. Those bad candidates then accumulated
21 apparently high-quality resource links. At national scale, enrichment will
magnify any identity error unless candidate admission and link provenance are
fixed first.

## Product definition

For each canonical venue, the system should answer:

1. Is this a real food venue in the claimed Italian municipality?
2. What is its official website or official location page?
3. Which URLs are actual menus, menu PDFs/images, ordering pages, drinks lists,
   or specialty pages for this venue?
4. Why was each identity and link accepted, and from which source?
5. When was it last checked, and is it still reachable?

The system should prefer returning no link over returning a confident but
incorrect link. Lower-confidence candidates may be retained for review, but
must not be mixed into publishable results.

## Lessons from Oderzo

### What worked

- OSM supplied a stable local candidate set with coordinates and five unique
  business websites.
- Full enrichment completed for all 53 rows in about 104 seconds on the warm
  run.
- The refined resource model reduced hundreds of noisy links to 48 links with
  roles and confidence.
- Direct official websites yielded useful deeper menu/resource pages.

### What failed

- Web search results were admitted as venues without positive municipality or
  province evidence.
- Page metadata was trusted even when it contradicted the requested location.
- `extractItalianAddress()` appended `Oderzo` to unrelated Milan and Rome
  streets, manufacturing apparently local addresses.
- Generic lists, directories, and Wikimedia boilerplate became venue names.
- Exact name deduplication missed the OSM node/way duplicate for Ca'Lozzio.
- Web aliases such as Al Giardinetto and Locanda Dussin were not merged into
  their OSM records, so useful official sites were lost between scans.
- `sources_used` described enabled sources instead of successful source runs.
- The output does not make website provenance explicit enough to distinguish
  an OSM website from one selected by search.

## Proposed national architecture

```text
Italy OSM extract + municipality boundaries
                 |
                 v
       canonical venue registry
       identity, aliases, coordinates,
       source facts and confidence
                 |
                 v
       persistent enrichment queue
        /          |             \
 known website   focused search   later gap discovery
 crawl first     only if needed   strict admission
        \          |             /
                 v
        evidence-based validator
       venue identity + URL role
                 |
                 v
       accepted links / review queue /
       rejected evidence + reason
                 |
                 v
        versioned publishable dataset
```

### 1. National candidate backbone

Import the Italy OSM PBF once and filter the supported food-related tags.
Assign each object to an ISTAT municipality using administrative boundaries.
This replaces thousands of town-by-town Nominatim and Overpass requests for
the national job. Interactive single-town scans may keep the current online
path.

Use OSM facts as evidence, not unquestioned truth. Preserve OSM object IDs,
coordinates, names, addresses, phone numbers, cuisine, and website tags with
field-level provenance.

### 2. Canonical venue identity

Create one canonical venue record with zero or more source records and aliases.
Deduplication should combine:

- normalized name and aliases;
- distance between coordinates;
- normalized address and postcode;
- phone number;
- canonical website domain/path;
- chain/location identity;
- OSM node/way/relation relationships.

Do not merge on fuzzy name alone. Store merge evidence and make merges
reversible.

### 3. Website-first enrichment

The current menu finder searches before crawling even when OSM already
provides a website. Reverse the order:

1. Validate and crawl a known website/location page.
2. Extract likely menu and ordering links from that site.
3. Search only if the known site is absent, invalid, or has no useful links.
4. Use a second or loose search only after the focused query fails validation.

This preserves the web-enrichment goal while reducing search cost and exposure
to irrelevant results.

### 4. Evidence-based search

Every search candidate should receive separate scores for:

- venue identity;
- geographic identity;
- official-site likelihood;
- resource-role likelihood.

A result must not become a venue merely because its page contains restaurant
terms. A web-only venue needs positive local evidence such as municipality plus
province, postcode, matching street, coordinates within the boundary, or
agreement from two independent sources. Contradictory city/province evidence
must cause rejection, not be overwritten.

Keep three outcomes:

- `accepted`: safe for the published dataset;
- `review`: plausible but insufficient evidence;
- `rejected`: wrong identity, wrong location, generic/list page, unsafe URL,
  or irrelevant resource.

### 5. Link validation

Validate the venue and the resource independently. A correct restaurant can
still produce an incorrect menu link, and a menu-looking URL can belong to a
different branch or business.

Useful signals include same official domain, venue/location text, canonical
links, structured data, PDF metadata, link labels, nearby page text, response
content type, and final redirect target. Penalize generic directories, city
lists, unrelated branches, boilerplate, expired pages, login pages, and
third-party pages without venue identity.

Each accepted resource should retain:

```json
{
  "url": "https://example.it/menu.pdf",
  "role": "menu",
  "venue_confidence": "high",
  "resource_confidence": "high",
  "found_via": "official_website",
  "source_url": "https://example.it/",
  "evidence": ["same_domain", "menu_anchor", "venue_name"],
  "checked_at": "2026-08-26T12:00:00Z",
  "http_status": 200
}
```

### 6. Persistent, resumable execution

National enrichment must use durable jobs rather than one long process. A job
should have a stable venue ID, stage, priority, attempt count, next retry time,
lease/worker ownership, source budget, and terminal outcome.

Required controls:

- bounded retries with exponential backoff and jitter;
- per-provider and per-domain rate/concurrency limits;
- global daily request and cost budgets;
- idempotent writes and checkpointed stages;
- provider circuit breakers;
- dead-letter/review queues;
- cache reuse by canonical URL and venue, not merely by town query;
- run manifests with code/scoring versions and source health.

### 7. Incremental refreshes

Do not repeatedly rescan the whole country. Refresh based on evidence:

- OSM replication changes update candidate facts;
- stale or failing websites receive targeted checks;
- resources get a role-dependent refresh interval;
- successful stable links are checked less often;
- rejected search results receive a cooldown;
- material identity changes re-open validation.

## Quality model and release gates

Build a manually reviewed benchmark before further scorer tuning. Include true
venues, aliases, chains, duplicate OSM objects, web-only venues, misleading
city lists, generic directories, closed sites, PDFs, images, ordering pages,
and hard negatives from the Oderzo failure set.

Track at least:

- venue admission precision and recall;
- official-website precision and coverage;
- resource-link precision by role;
- duplicate and incorrect-merge rates;
- municipality assignment accuracy;
- percentage with explicit provenance;
- requests, cache hits, elapsed time, and cost per accepted link;
- source failure and retry rates.

Initial publication gates for the pilot:

- no fabricated or inferred addresses presented as source facts;
- 100% of websites and resources have provenance and validation reasons;
- at least 98% precision for published venue identity;
- at least 95% precision for published official websites;
- at least 95% precision for published menu/resource roles;
- fewer than 1% unresolved duplicates in the reviewed sample;
- a source outage cannot remove the stable OSM candidate baseline;
- lower-confidence items remain in review rather than publication.

Recall should be measured and improved, but not by weakening these precision
gates. Thresholds can be revised after the benchmark is large enough to make
the estimates meaningful.

## Session-by-session execution plan

Each session is intended to be independently completable and reviewable. Do
not start the national importer or queue before the correctness gates and
fixtures exist.

### Session 1 — Build the benchmark and evaluator

Goal: make correctness measurable before changing scoring.

Work:

- Convert the Oderzo findings into labelled fixtures for venue validity,
  official websites, duplicates, and resource roles.
- Add a small stratified set of municipalities: at least one rural town, one
  tourism-heavy town, one same-name ambiguity, one medium city, and one large
  city district/sample.
- Create a deterministic evaluator that compares scan output with accepted,
  rejected, alias, and duplicate labels.
- Report precision, recall, false positives, false negatives, and link-role
  precision separately.
- Save run configuration and cache/fixture provenance so results are
  reproducible without live search.

Deliverables:

- versioned benchmark fixtures;
- evaluator command and tests;
- baseline metrics for current code;
- documented labelling rules.

Exit criteria:

- the eight Oderzo false positives fail venue admission;
- known good Oderzo venues and links are represented in the fixture;
- repeated offline evaluation gives identical results.

### Session 2 — Fix venue admission and location truth

Goal: stop unrelated web results from becoming local venues.

Work:

- Remove the behavior that appends the requested town to an unverified street.
- Represent extracted address components and their source separately.
- Require positive municipality/province/postcode/coordinate evidence for
  web-only admission.
- Reject explicit geographic contradictions.
- Expand generic list, editorial, directory, and boilerplate detection using
  evidence classes rather than only a growing phrase blacklist.
- Add structured rejection reasons to logs/evaluation output.

Deliverables:

- location-evidence scorer;
- regression tests for Milan/Rome/Como/Wikimedia failures;
- before/after benchmark report.

Exit criteria:

- zero fabricated Oderzo addresses;
- all eight known false positives are rejected;
- Barhacca and Pub Gatto Nero remain accepted;
- venue precision meets the initial gate on the benchmark.

### Session 3 — Add field-level provenance and source health

Goal: make every accepted fact auditable.

Work:

- Add provenance for names, addresses, phones, websites, coordinates, and
  resources.
- Distinguish an OSM website, a crawled canonical website, and a
  search-selected website.
- Replace or supplement `sources_used` with attempted/succeeded/failed source
  status, counts, duration, and errors.
- Version the output schema and add backward-compatible UI handling.
- Ensure snippets and fetched page bodies remain transient rather than
  publishable output.

Deliverables:

- versioned schema and migration/compatibility path;
- source-run manifest;
- schema and UI tests.

Exit criteria:

- every published field can answer “where did this come from?”;
- a zero-result or failed source is visible;
- existing saved scans still load or fail with an explicit version message.

### Session 4 — Improve canonical identity and deduplication

Goal: unify duplicate/alias records without unsafe fuzzy merges.

Work:

- Introduce a canonical venue ID separate from source IDs.
- Normalize punctuation, spacing, legal suffixes, restaurant prefixes, phone
  numbers, domains, and addresses.
- Score merge evidence using distance plus identity fields.
- Merge Ca'Lozzio's node/way pair and connect Giardinetto/Al Giardinetto and
  Dussin/Locanda Dussin when evidence supports it.
- Preserve source records, aliases, and reversible merge decisions.
- Add chain/location safeguards.

Deliverables:

- deterministic identity module;
- duplicate fixtures and tests;
- merge audit data in output or run manifests.

Exit criteria:

- known Oderzo duplicates collapse correctly;
- distinct nearby venues remain separate;
- benchmark duplicate and incorrect-merge gates pass.

### Session 5 — Make enrichment website-first

Goal: obtain more useful links with fewer searches.

Work:

- Validate and crawl OSM/known official websites before issuing search queries.
- Search only when the direct crawl is absent, invalid, or yields no useful
  resource.
- Cache by canonical URL/domain and avoid repeated crawling across aliases.
- Handle chain homepages versus branch pages explicitly.
- Record request counts and reasons for each fallback.

Deliverables:

- reordered enrichment pipeline;
- request-budget instrumentation;
- comparison of accepted links and search calls on the benchmark.

Exit criteria:

- no loss of valid benchmark links;
- materially fewer search calls for venues with usable OSM websites;
- every search invocation has a recorded fallback reason.

### Session 6 — Refine official-website selection

Goal: select the correct venue or branch website reliably.

Work:

- Separate identity, geography, officialness, and confidence scores.
- Validate redirects, canonical URLs, structured business data, contact facts,
  and branch/location text.
- Improve handling of chains, hotels with restaurants, booking providers,
  social pages, and directory pages.
- Add accepted/review/rejected outcomes and evidence explanations.
- Calibrate thresholds from benchmark errors rather than individual anecdotes.

Deliverables:

- explainable website selector;
- hard-negative fixtures;
- threshold calibration report.

Exit criteria:

- official-website precision meets the pilot gate;
- wrong-city and wrong-branch sites are rejected or held for review;
- confidence correlates with measured precision.

### Session 7 — Refine menu/resource extraction and validation

Goal: improve precision and recall of the links users actually want.

Work:

- Validate HTTP status, redirect destination, content type, canonical URL, and
  same-venue evidence.
- Improve PDF, image-menu, JavaScript-site, sitemap, and ordering-page handling.
- Distinguish menu, drinks, order, specialty, venue page, and secondary source.
- Reject boilerplate, unrelated images, other branches, expired files, and
  generic directory pages.
- Deduplicate URL variants and retain the best evidence.

Deliverables:

- resource validator with role-specific evidence;
- positive and hard-negative resource fixtures;
- precision/recall report by role.

Exit criteria:

- resource precision meets the pilot gate for each publishable role;
- no known unsafe/irrelevant hard negative is published;
- lower-confidence but useful links are retained in review data.

### Session 8 — Add a durable venue store and enrichment queue

Goal: make long-running enrichment resumable and idempotent.

Work:

- Select SQLite for a single-machine pilot or PostgreSQL for multi-worker
  deployment based on expected concurrency and operations.
- Model canonical venues, source facts, aliases, resources, evidence, jobs,
  attempts, and run manifests.
- Implement leases, retries, backoff, priorities, dead-letter outcomes, and
  graceful restart.
- Add global/provider/domain concurrency and request budgets.
- Keep exports compatible with the UI.

Deliverables:

- schema/migrations;
- queue worker and recovery tests;
- JSON export path;
- operational commands for status, retry, and cancellation.

Exit criteria:

- killing and restarting a worker neither loses nor duplicates results;
- repeated jobs are idempotent;
- budgets and circuit breakers work under simulated failures.

### Session 9 — Build the offline Italy candidate importer

Goal: create the national venue backbone without town-by-town public API use.

Work:

- Document and automate acquisition/checksum/versioning of the Italy OSM PBF
  and municipality boundary source.
- Filter supported food venue tags and retain necessary attribution/provenance.
- Spatially assign venues to ISTAT municipalities.
- Feed records through the canonical identity layer.
- Produce inventory counts by region, municipality, venue type, website
  coverage, and duplicate status.

Deliverables:

- reproducible importer;
- import manifest and attribution;
- national inventory report;
- sampled assignment/deduplication tests.

Exit criteria:

- a clean import can be repeated from documented inputs;
- sampled municipality assignments meet the accuracy gate;
- no public Nominatim/Overpass calls are needed for the national import.

### Session 10 — Run a stratified end-to-end pilot

Goal: measure real quality, throughput, and cost before broad rollout.

Work:

- Select municipalities across regions, sizes, tourism levels, language
  variants, chains, and OSM website coverage.
- Run cold-cache and warm/incremental scenarios.
- Manually review statistically useful samples of venues, websites, and
  resource roles.
- Measure accepted links per request, search cost, crawl volume, error rates,
  queue latency, and storage growth.
- Feed newly discovered hard cases back into the benchmark.

Deliverables:

- pilot dataset and review labels;
- quality/cost/capacity report;
- revised thresholds and national resource estimate;
- go/no-go decision for regional expansion.

Exit criteria:

- all publication quality gates pass with confidence intervals reported;
- provider terms and budgets cover the proposed next stage;
- no unresolved systemic false-positive class remains.

### Session 11 — Compliance and production operations gate

Goal: make the system safe to operate and publish.

Work:

- Resolve search-provider and PagineGialle permissions, storage, attribution,
  and redistribution terms.
- Complete ODbL classification/attribution and database distribution review.
- Complete the privacy controller, lawful basis, notice, processor, transfer,
  retention, correction, and erasure requirements in the existing docs.
- Add monitoring for source health, queue depth, error rate, precision samples,
  stale links, storage, and budget consumption.
- Define backup, restore, incident, suppression, and rollback procedures.

Deliverables:

- approved release checklist;
- monitoring and alerting;
- retention/erasure automation for the durable store;
- runbook and rollback exercise.

Exit criteria:

- all release gates in `DATA-LICENSING.md` and `PRIVACY.md` are resolved rather
  than placeholders;
- a failed provider or bad scoring release can be detected and rolled back;
- an accepted correction/erasure can propagate to published exports.

### Session 12 — Regional waves, then national coverage

Goal: expand without losing measurable correctness.

Work:

- Process one region or capacity-sized wave at a time.
- Sample and review every wave before publication.
- Pause automatically when quality, error, or budget thresholds fail.
- Publish versioned datasets with attribution and freshness metadata.
- Schedule incremental refreshes based on staleness and source changes.

Deliverables:

- wave manifests and quality reports;
- versioned regional/national exports;
- refresh schedule and capacity dashboard.

Exit criteria:

- all intended regions are processed and pass the same quality gates;
- failed or uncertain records remain quarantined;
- ongoing refresh cost and quality are operationally sustainable.

## Session handoff protocol

At the start of every implementation session:

1. Read this plan and `ODERZO-SCAN-REPORT.md`.
2. Inspect `git status` and preserve unrelated user changes.
3. Run the existing test suite and record the baseline.
4. Select exactly one session objective unless a dependency is trivial.
5. Use cached/fixture evaluation before live network runs wherever possible.

At the end of every session, append a short entry to the progress log below:

- date and session number;
- commits/files changed;
- commands/tests run;
- before/after quality and request metrics;
- decisions and threshold changes;
- known failures and the next bounded task.

Do not call a session complete merely because the code runs. Its exit criteria
and regression gates must pass.

## Progress log

| Session | Status | Date | Result / next action |
| --- | --- | --- | --- |
| 1. Benchmark and evaluator | Complete | 2026-08-26 | Versioned offline fixtures, deterministic evaluator, baseline, and labelling rules added. |
| 2. Venue/location admission | Complete | 2026-08-26 | Known false positives rejected; benchmark venue precision 100%, recall 75%. |
| 3. Provenance/source health | Complete | 2026-08-26 | Schema v2, field provenance, source-run manifests, and legacy UI compatibility added. |
| 4. Canonical identity/dedupe | Complete | 2026-08-26 | Corroborated identity module resolves 1/1 labelled duplicate groups with reversible audit evidence. |
| 5. Website-first enrichment | Complete | 2026-08-26 | Known-site fixture preserves 4/4 links while reducing search calls from 4 to 0; fallback reasons and request telemetry added. |
| 6. Official website selection | Complete | 2026-08-26 | Explainable three-axis scorer passes 5 official, 1 review, and 5 hard-negative cases at 100% fixture precision/recall. |
| 7. Resource validation | Complete | 2026-08-27 | Role-specific validator and hard negatives pass at 100% fixture precision/recall; live acceptance preserved 37 reviewed resources. |
| 8. Durable store/queue | Not started | — | SQLite evidence persistence exists, but the resumable leased job queue and operational controls remain the next scaling objective. |
| 9. Italy OSM importer | Not started | — | Begin only after identity model stabilizes. |
| 10. Stratified pilot | Not started | — | Produce go/no-go evidence. |
| 11. Compliance/operations | Not started | — | Required before public release. |
| 12. Regional/national waves | Not started | — | Quality-gated rollout. |

## Deliberately deferred choices

- Search provider and commercial budget: record actual provider terms before
  capacity planning.
- SQLite versus PostgreSQL: decide after expected worker/concurrency needs are
  measured; keep the data model portable.
- Exact national hardware and duration: estimate from the stratified cold-cache
  pilot, not from Oderzo alone.
- Automated web-only venue discovery nationwide: keep separate from enrichment
  of known candidates until its precision gate is proven.
- Use of language models for classification: evaluate only against the same
  benchmark, provenance, latency, privacy, and cost gates as deterministic
  scoring.

## References

- Findings: `ODERZO-SCAN-REPORT.md`
- Current pipeline: `PLAN.md`
- Licensing and source constraints: `DATA-LICENSING.md`
- Privacy and retention gates: `PRIVACY.md`
- Nominatim policy: <https://operations.osmfoundation.org/policies/nominatim/>
- Overpass guidance: <https://wiki.openstreetmap.org/wiki/Overpass_API>
- Italy OSM extract: <https://download.geofabrik.de/europe/italy.html>
