# Search recall recovery and efficiency plan

Date: 2026-08-27
Status: completed and archived after Phase 8 live acceptance GO (75/75 gates)
Starting evidence: `benchmark/ODERZO-LIVE-SEARCH-REGRESSION-REPORT.md`
Scope: restore venue, official-website, and useful-resource recall without
weakening the Session 6/7 publication precision rules. Do not begin Session 8
national scaling until the live gates at the end of this plan pass.

## Executive decision

The current generic web search must stop acting as both a place database and a
website finder. It is unreliable at venue enumeration, expensive when repeated
per venue, and unable to express provider health. The replacement should have
four explicit layers:

1. **Structured venue discovery:** keep OSM and add one structured place source
   for the pilot, preferably an Overture Places extract and/or Brave Place
   Search. These sources create candidate venues; ordinary web pages do not
   become venues without corroborating local identity evidence.
2. **Evidence graph and identity resolution:** combine aliases, coordinates,
   address, phone, postcode, and source URLs before searching for websites.
3. **Outcome-driven official-site resolution:** issue focused searches only for
   unresolved venues, crawl a bounded shortlist, and continue until an official
   site is actually accepted or the per-venue budget is exhausted.
4. **First-party resource discovery:** crawl the accepted official site first;
   use one site-restricted search only when the crawl cannot find useful links.

The immediate provider recommendation is to replace scraped search-result HTML
with a supported JSON API. Test Brave Web Search first because the project
already prefers Brave and Brave now also offers Place Search. Keep provider
adapters so another licensed provider can be evaluated from the same replay
fixtures. Do not use scraped Bing HTML as a production fallback: its relevance
is poor in the captured Oderzo requests, and Microsoft's supported Bing Search
APIs were retired on 2025-08-11.

PagineGialle should be disabled as a normal production source until a permitted,
documented access route and redistribution terms are confirmed. A
`site:paginegialle.it` result may be retained temporarily as a search lead only
when the returned hostname actually matches PagineGialle; it must never be an
official website. A response containing no matching-domain result is degraded,
not successful.

## Evidence found after the regression report

### Repository evidence

- `lib/search.mjs` caches by only `query + limit`, returns a bare result array,
  and loses HTTP status, provider attempts, fallback reasons, timing, and cache
  health. A non-empty irrelevant Bing response is cached for 24 hours.
- The outer one-second scheduler cannot see the Brave retry inside
  `researcher/scripts/search.mjs`. A retry at `t+2s` can collide with new child
  processes launched by the outer scheduler, extending a rate-limit episode.
- The external search script accepts the first engine that parses any results.
  It explicitly warns that Bing may be irrelevant, but `lib/search.mjs` parses
  and caches those results as ordinary success.
- Discovery launches broad web and PagineGialle search concurrently. Enrichment
  then runs four workers sharing the same provider. Provider-specific budgets,
  retry ownership, and circuit breaking do not exist.
- The 2026-08-26 Oderzo scan made 114 enrichment searches for 42 venues, plus
  six broad/directory discovery searches, but published only three official
  websites and resources for two venues.
- `huntViaSearch()` stops when any result passes `scoreSearchCandidate()`. A
  directory can pass that scorer even though it cannot be an official website.
- `chooseOfficialWebsite()` selects one accepted-or-review candidate before
  crawling. If that candidate remains review or becomes rejected after crawl,
  the resolver does not crawl the next candidate.
- A known accepted website with no resources triggers generic identity, menu,
  and loose-name searches. That spends website-identification calls even though
  the website identity has already been resolved.
- `huntViaSearch()` derives the town using the first whitespace-delimited word.
  `Motta di Livenza TV` therefore becomes `Motta`. Search and validation need a
  structured location object, not reparsing a display string.
- Identity already recognizes generic Italian prefixes, so `Giardinetto` and
  `Al Giardinetto` have a name-alias edge. They do not merge because neither
  record supplies the required independent phone/address/coordinate/site edge.
- Resource candidates are validated before the final cap is applied. Many
  image/page requests can therefore be made for items that can never be
  published.
- Role classification lets page-wide text override the anchor and URL role.
  This explains `menu -> specialty` and generic page -> `order` drift.
- Reuse of enriched facts is tied to the same dated output filename. A new day
  can lose a previously accepted site because of a transient provider failure.

Captured cache examples make the provider problem deterministic:

- `"Giardinetto" "Oderzo" ristorante` returned eight Bing results, all
  namesakes or generic pages, and was cached.
- `ristoranti Oderzo sito web` returned generic Italy/Rome/near-me directories
  and no useful Oderzo venue.
- `site:paginegialle.it Oderzo ristorante` returned Google Translate, Reddit,
  and Stack Overflow URLs, yet the source was recorded as succeeded.
- A cached Brave query for `"Barhacca" "Oderzo" ristorante` contained the
  current official site as result seven.

### Live search evidence

Checks on 2026-08-27 confirmed that the missing sites and resources are still
indexable:

- Barhacca's official site identifies itself as a bar/panineria in Oderzo and
  links to ordering: <https://www.barhacca.it/>.
- Al Giardinetto's official page contains name, address, postcode, municipality,
  province, and phone: <https://www.algiardinetto-oderzo.it/chi-siamo-orari/>.
- Its current first-party menu is indexable at
  <https://www.algiardinetto-oderzo.it/men%C3%B9-alla-carta/>.
- Postcode-oriented searches such as `"31046" ristorante menu` surfaced
  useful official sites for Ragazzon, Nuovo Ronche, Koi Sushi, Old Wild West,
  Gellius, and other local businesses. This is a much stronger broad-search
  axis than `ristoranti Oderzo sito web`, but it still needs structured
  admission and must not replace a place source.

### Current provider and dataset options

- Brave's supported Web Search API returns structured JSON and exposes rate
  headers for per-second and monthly windows. Its documentation says to honor
  `X-RateLimit-Reset`, distribute requests evenly, and use retry backoff:
  <https://api-dashboard.search.brave.com/documentation/guides/rate-limiting>.
- Brave Place Search, added in 2026, is designed for geographic POI discovery
  and returns names, coordinates, postal addresses, categories, a website URL,
  and a provider URL:
  <https://api-dashboard.search.brave.com/documentation/services/place-search>.
- Overture Places is an open monthly dataset with stable IDs, geometry, names,
  addresses, websites, phones, categories, confidence, and multi-provider
  conflation. A bounding-box download avoids per-venue network search:
  <https://docs.overturemaps.org/guides/places/> and
  <https://docs.overturemaps.org/getting-data/>.
- Google Places Text Search can return structured place identity and website
  fields with field masks, but website data is in a higher billing tier and use
  is subject to Maps Platform policies and EEA terms. Treat it only as an
  optional benchmark challenger after a licensing/retention review:
  <https://developers.google.com/maps/documentation/places/web-service/text-search>.
- Microsoft's supported Bing Search APIs were retired on 2025-08-11:
  <https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement>.

## Target pipeline

```text
structured LocationContext
        |
        +--> OSM town query -------------------+
        +--> Overture/Place Search ------------+--> candidate evidence graph
        +--> bounded postcode web gap query ---+            |
                                                             v
                                              canonical venue + aliases
                                                             |
                                    known site? -------------+------------- no site
                                        |                                  |
                                  validate/crawl                    focused resolver
                                        |                          query -> rank -> crawl
                                        +---------------+------------------+
                                                        v
                                              accepted official site
                                                        |
                                      first-party crawl + sitemap hints
                                                        |
                              no useful link? -> one `site:domain` search
                                                        |
                                                        v
                                  pre-rank/cap -> fetch -> role/freshness validate
```

Publication remains strict. Recall is recovered by obtaining better evidence
and trying the next bounded candidate, not by lowering acceptance thresholds.

## Required data contracts

### LocationContext

Stop passing strings such as `"Motta di Livenza TV"` between layers.

```json
{
  "municipality": "Motta di Livenza",
  "province_code": "TV",
  "region": "Veneto",
  "country_code": "IT",
  "postcodes": ["31045"],
  "centroid": { "latitude": 45.77, "longitude": 12.61 },
  "bbox": [12.5, 45.7, 12.7, 45.9],
  "osm_relation_id": "..."
}
```

Populate this once from the municipality lookup plus checked-in municipality
metadata. All sources, scorers, and query builders receive the same object.

### Search response

Replace the bare result array with a response that distinguishes transport,
query fidelity, source usefulness, and cache behavior.

```json
{
  "request_id": "stable-id",
  "purpose": "official_site",
  "query": "\"Al Giardinetto\" \"Oderzo\"",
  "provider": "brave_web_api",
  "outcome": "relevant",
  "attempts": [
    {
      "provider": "brave_web_api",
      "http_status": 200,
      "transport_ok": true,
      "parse_ok": true,
      "raw_count": 10,
      "relevant_count": 3,
      "duration_ms": 420,
      "reason": "query_fidelity_passed"
    }
  ],
  "cache": { "status": "miss", "stored": true, "ttl_seconds": 86400 },
  "results": []
}
```

Supported outcomes: `relevant`, `irrelevant`, `empty`, `rate_limited`,
`provider_failed`, and `budget_exhausted`. A source run may then be
`succeeded`, `degraded`, `failed`, or `disabled`; zero useful candidates is a
separate field, not inferred from transport status.

### Search cache key and entry

Include at least:

- provider and endpoint version;
- normalized query, locale/country, result limit, and search purpose;
- location identity and query-fidelity scorer version;
- parsed results, attempt metadata, health outcome, and timestamps.

Cache relevant responses normally. Cache 429/provider failures only briefly to
prevent a retry storm. Do not cache an irrelevant response as a reusable success.
Permit stale relevant results as leads while asynchronously revalidating them;
never let stale search snippets directly authorize publication.

## Query-fidelity rules

Provider health is purpose-specific and precedes venue admission:

- **Domain-constrained query:** at least one returned hostname matches the
  requested domain. Otherwise mark the attempt `irrelevant` and try the next
  permitted provider or stop degraded.
- **Targeted venue query:** at least one top result must contain a venue alias or
  normalized phone plus one local signal (municipality, postcode, province,
  street, or matching domain). A generic name alone does not prove fidelity.
- **Broad gap-discovery query:** at least one result must have food-business
  context and an explicit municipality/postcode signal, with no contradictory
  province. Track the aligned-result ratio in the top results.
- A provider response may be healthy even when no candidate is publishable;
  provider fidelity and candidate acceptance must stay distinct.

Do not make a permanent provider-quality penalty such as `bing = -8` part of a
venue score. Reject an unfaithful response at the provider layer and preserve
candidate scoring as provider-neutral evidence logic.

## Query planner and budgets

### Town-level candidate discovery

Run structured sources first. For the Oderzo pilot:

1. One Nominatim municipality lookup plus one OSM Overpass query, as today.
2. One local Overture Places extraction for the municipality bbox, or bounded
   Brave Place Search calls covering the supported food categories.
3. Only if the labelled truth set still has gaps, test at most four broad web
   queries built from municipality, province, and postcode. Candidate templates
   to replay include `"<postcode>" ristorante menu`, `"<postcode>" pizzeria
   menu`, and `"<municipality>" "<province>" ristorante menu`.
4. Deduplicate result domains and venue identities before fetching any page.

Do not issue three generic town/category searches unconditionally. The plan
must report the marginal true venues and official domains added by every query
template so low-yield templates can be removed.

### Official-site resolver per venue

Use the strongest available identity in this order:

1. Validate a source-provided official URL.
2. Exact phone search when a normalized phone is known.
3. Exact canonical name or alias plus municipality and postcode.
4. Exact name plus street and municipality for generic or ambiguous names.
5. One alias/core-name fallback.

For each result set, rank official-looking domains, then crawl candidates in
score order until one is accepted. Do not let a review candidate, directory,
or relevant-but-nonofficial result stop the resolver. Search again only after
all candidates from the current response have been rejected or left in review.

Default budget per unresolved venue:

- at most two web searches;
- at most three candidate-site crawls;
- permit a third search only for a labelled/high-confidence venue with strong
  independent local evidence and record `budget_escalation_reason`;
- stop immediately on an accepted official website.

The resolver's stop condition is exactly `official_site.status == accepted` or
`budget exhausted`.

### Resource discovery after website acceptance

1. Keep the accepted website even if it has no resource links.
2. Crawl the homepage/location page and high-signal same-domain links.
3. Read declared sitemap locations first; try common sitemap paths sequentially
   and stop after useful results rather than launching all variants together.
4. If still empty, issue at most one combined site-restricted query such as
   `site:<official-domain> (menu OR menù OR carta OR ordina OR asporto)`.
5. Rank and cap candidates *before* network validation. Reserve slots by role
   so images or seasonal PDFs cannot consume the whole budget.
6. Apply bounded-body reads; do not download an unbounded PDF/image into a text
   buffer. Record content length, last-modified, and final URL when available.

Default per-site network budget should be measured in the replay fixture, with
an initial ceiling of one homepage crawl, two sitemap/navigation crawls, one
site search, and eight resource validations. Lower the ceiling when evidence
shows the same recall with fewer requests.

## Identity and evidence changes

- Preserve all source names as aliases before choosing a display name.
- Add source-record fields for postcode, structured address components,
  provider place ID, and provider record URL.
- Add exact postcode and normalized street-number matches to merge evidence.
- A `Giardinetto` / `Al Giardinetto` core-name match should merge only when a
  second edge agrees: phone, address, coordinate distance, official domain, or
  an independent structured place/directory record.
- Treat directories as identity witnesses and search leads only. Their names,
  addresses, and phones need provenance and must not overwrite stronger OSM or
  first-party facts silently.
- Keep merge decisions reversible and emit unmatched high-similarity pairs to
  review rather than lowering the merge threshold.
- Use aliases in official-site queries and website validation; do not validate
  only against the chosen display name.

## Resource role and freshness changes

Implement these after website recall is restored, but keep them in the same
acceptance run:

- Determine the initial role from URL, anchor label, nearby DOM context, and
  content type. Page-wide body terms may support confidence but must not
  override a strong anchor/URL role.
- Extract page title, `h1`, JSON-LD, and canonical metadata separately from
  arbitrary body text.
- Detect year/date signals in URL, anchor, PDF metadata, and response headers.
  Old seasonal/event resources should be rejected or reviewed; a stable
  undated à-la-carte menu may remain valid if current and linked by the site.
- Apply role-diverse preselection before validation, then final ranking after
  validation.
- Report accepted, review, rejected, pre-cap dropped, and post-cap dropped
  counts per role so the final cap cannot hide classifier errors.

## Durable evidence and refresh

Create a small persistent evidence store independent of the daily scan file.
SQLite is sufficient for the pilot and avoids introducing infrastructure.

Store:

- canonical venue and source records;
- accepted website/resource facts with first-seen, last-seen, last-checked,
  evidence version, and status;
- search attempts and provider health;
- negative/review decisions with retry-after timestamps;
- aliases and reversible merge edges.

A transient failed/degraded search must not delete a previously accepted fact.
Publish it as last-known-good with explicit staleness until its revalidation TTL
expires or positive contradictory evidence retires it. Separate `not observed
this run`, `temporarily unreachable`, `stale`, `rejected`, and `closed`.

## Execution sequence

Each phase must leave tests green and create a short checkpoint report. Do not
combine scorer rewrites with provider rewrites in one unmeasured change.

### Phase 0 — Freeze the live acceptance set

Goal: make recall measurable before changing search.

Work:

- Create a versioned `benchmark/v2` truth set from a manual review of every
  2026-08-25 and 2026-08-26 Oderzo row, not only the current small fixture.
- Include current venues missing from both scans if structured/live evidence
  finds them. Label closed/unknown separately from false.
- Record aliases, addresses, phones, coordinates, official sites, and current
  resources with evidence URLs and review dates.
- Add query replay fixtures for the four captured searches above, including
  provider and response-health labels.
- Extend evaluation to venue recall by source class, web-only recall, official
  website precision/recall, resource role precision/recall, and request cost.

Exit:

- no unlabelled Oderzo output row;
- Barhacca and Al Giardinetto have current positive labels;
- hard negatives from v1 remain represented;
- the current 2026-08-26 scan fails recall gates for the documented reasons.

### Phase 1 — Introduce provider contracts and replay, without tuning admission

Likely files: new `lib/search-client.mjs`, `lib/search-health.mjs`, provider
adapters under `sources/search/`, `lib/cache.mjs`, `lib/search.mjs`, and tests.

Work:

- Add the structured request/response contracts and dependency injection.
- Parse and preserve every provider attempt, HTTP outcome, timing, and rate
  header.
- Make old `search()` callers use a compatibility adapter temporarily.
- Replay Brave-good, Bing-irrelevant, domain-mismatch, empty, 429, timeout, and
  parser-change fixtures without network access.

Exit:

- the cached PagineGialle/Bing response is `irrelevant`, not success;
- no response loses provider-attempt metadata;
- all existing deterministic benchmarks still run.

### Phase 2 — Fix scheduling, fallback, cache, and source health

Work:

- Move rate limiting and retries into one provider-owned scheduler; the
  scheduler must own retries as well as first attempts.
- Honor provider reset headers, add jittered backoff, a circuit breaker, and
  separate per-provider concurrency/budgets.
- Fall through on unhealthy non-empty responses.
- Version and namespace cache entries; add an isolated cache directory option
  for cold-cache acceptance runs.
- Add `degraded` source runs and useful-result counters.
- Remove scraped Bing HTML from production fallback; retain only an explicit
  diagnostic mode if useful.

Exit:

- deterministic concurrency test produces no overlapping calls at a one-RPS
  limit, including retries;
- irrelevant results never poison another provider's cache entry;
- PagineGialle zero matching-domain results produce `degraded`;
- simulated provider outage does not claim `succeeded`.

### Phase 3 — Add a structured recall source and bounded gap discovery

Work:

- Implement and benchmark an Oderzo Overture Places bbox import first because
  it is open, local, and reusable. Map food taxonomy, websites, phones,
  addresses, confidence, geometry, and stable IDs with provenance.
- In parallel or as the next adapter, run a small Brave Place Search evaluation
  if a supported API key/plan is available.
- Compare incremental truth-set recall, duplicates, wrong categories, and
  official URLs for OSM alone, OSM+Overture, and OSM+Brave Places.
- Add postcode query templates only for residual truth-set gaps and keep only
  templates with measured marginal value.
- Resolve PagineGialle permission/licensing. Disable it by default if no
  permitted route is documented.

Exit:

- Barhacca or equivalent web-only cases reach the candidate graph without
  depending on three generic broad web searches;
- every added candidate has explicit local geometry/address evidence;
- town-level web calls are bounded and their marginal yield is reported.

### Phase 4 — Strengthen identity and structured location

Likely files: `sources/nominatim.mjs`, `discover.mjs`, `lib/identity.mjs`, scan
schema, and identity tests.

Work:

- Introduce `LocationContext` end to end and remove first-word town parsing.
- Add postcode/address/place IDs and alias-aware matching.
- Add evidence edges from the structured place source and permitted directory
  leads.
- Add `Giardinetto` / `Al Giardinetto`, multiword-town, same-name-town,
  wrong-branch, and nearby-distinct-venue fixtures.

Exit:

- Giardinetto merges safely with Al Giardinetto using a non-name corroborator;
- multiword municipality queries retain the full municipality;
- no fuzzy-name-only merge is published.

### Phase 5 — Replace enrichment fallback with the resolver state machine

Likely files: split `find-menu.mjs` into official-site resolver, site crawler,
and resource validator modules while retaining a compatibility export.

Work:

- Separate website identity search from resource search.
- Crawl multiple ranked site candidates within budget.
- Stop only on accepted official site or exhausted budget.
- Query aliases, phone, address, and postcode according to available evidence.
- Keep accepted websites that contain no resource.
- Add exact tests for a plausible wrong first namesake followed by the correct
  result, a directory first result, and a review candidate before an accepted
  candidate.

Exit:

- Al Giardinetto's wrong hotel namesake cannot stop the resolver;
- Barhacca's later-ranked official result can be selected;
- a known official site with no menu does not trigger generic identity search;
- no venue exceeds its configured search/crawl budget.

### Phase 6 — Make resource finding efficient and role-safe

Work:

- Apply pre-validation caps and role diversity.
- Add sequential sitemap discovery and one site-restricted fallback.
- Add bounded response bodies and PDF/image handling.
- Separate anchor/URL role evidence from page-wide content.
- Add freshness decisions and per-stage drop metrics.

Exit:

- existing Session 7 precision does not regress;
- known current menu/order links are retained;
- stale seasonal fixtures are review/rejected;
- validation request count falls without reducing truth-set recall.

### Phase 7 — Persist last-known-good evidence

Work:

- Add the SQLite evidence store and migration/version metadata.
- Reuse facts across dates and aliases, not only the same output filename.
- Add staleness and retry scheduling.
- Test transient search outage, website timeout, renamed venue, and confirmed
  closure transitions.

Exit:

- a simulated one-run provider outage cannot remove an accepted current site;
- stale facts are visible and auditable, never silently fresh;
- positive contradictory evidence can retire a fact.

### Phase 8 — Cold-cache Oderzo acceptance and rollout decision

Run at least two isolated cold-cache scans and one warm scan. Use an output
variant and isolated cache; never overwrite the historical August 25/26 files.
Manually review all newly accepted venues/sites/resources and every lost known
fact. Save the provider manifest, query attempts, request counts, elapsed time,
and benchmark report.

Only after the gates below pass should the national importer/queue work resume.

## Release gates

Set final numeric recall denominators from the Phase 0 truth set. Initial gates:

### Correctness and recall

- venue precision >= 98%;
- venue recall >= 90% on reviewed current Oderzo venues;
- web-only venue recall >= 85%;
- official-website precision >= 98% with zero known wrong-branch publications;
- official-website recall >= 85%;
- resource-role precision >= 95% overall and no role below 90%;
- known current resource recall >= 80%;
- Barhacca venue, official homepage, and current order link are retained;
- Giardinetto and Al Giardinetto form one venue with the correct official site
  and current first-party menu;
- all v1 hard negatives remain unpublished.

### Health and efficiency

- every search attempt records provider, HTTP outcome, query-fidelity outcome,
  latency, cache status, and purpose;
- zero irrelevant non-empty responses are cached as successful;
- zero 429 collisions caused by the application's own scheduler in the
  acceptance scans;
- at most four broad web queries per town after structured discovery;
- median targeted searches per unresolved venue <= 1 and p95 <= 2;
- no venue exceeds three searches, and every third search has an escalation
  reason;
- total Oderzo web-search calls fall by at least 50% from the captured 120-call
  discovery+enrichment baseline while recall gates pass;
- report useful candidates, accepted sites, and accepted resources per query
  and per provider;
- a degraded provider cannot make the overall source manifest look healthy.

### Durability

- two consecutive cold-cache live scans pass precision/recall gates;
- a warm run demonstrates cache reuse without changing accepted output;
- a simulated transient source outage preserves last-known-good accepted facts
  with staleness metadata;
- output schema and provenance validators pass.

## Verification commands

Run the deterministic suite after every phase:

```bash
node --test
node benchmark/evaluate.mjs
node benchmark/evaluate-enrichment.mjs
node benchmark/evaluate-websites.mjs
node benchmark/evaluate-resources.mjs
```

The live command should use the cache/output isolation added in Phase 2. Until
then, use an `OUTPUT_VARIANT` and do not delete or overwrite existing evidence:

```bash
OUTPUT_VARIANT=search-recall-candidate TOP_N=100 node discover.mjs Oderzo TV
```

Every phase report must include `git status --short` before and after because
the repository already contains substantial uncommitted user work. Preserve
those changes and keep each phase narrowly scoped.

## Explicit non-goals

- Do not weaken website or resource publication thresholds to improve recall.
- Do not treat directories, social profiles, or ordering platforms as official
  websites.
- Do not scrape Google Maps or bypass directory bot controls.
- Do not start national-scale queues/imports before the Oderzo gates pass.
- Do not retain provider snippets as published venue content.
- Do not tune only to Barhacca and Al Giardinetto; use the full truth set and
  stratified v1 fixtures.

## First future-session handoff

Start with Phase 0 and the non-network part of Phase 1. Specifically:

1. Read this plan, the regression report, `benchmark/LABELLING.md`, and current
   `git status`.
2. Create the versioned Oderzo v2 truth-set schema and evaluator tests without
   changing old v1 fixtures.
3. Freeze the four cached provider-response fixtures and label their query
   fidelity.
4. Define the structured search request/response API and replay tests behind a
   compatibility adapter.
5. Run all offline evaluators and write a Phase 0/1 checkpoint report.

Do not require a provider key for this first implementation slice. At its end,
present the measured truth-set gaps and ask for/configure a supported Brave API
key only when beginning the live provider/Place Search evaluation.
