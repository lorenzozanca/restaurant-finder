# Oderzo live search and recall regression report

Date: 2026-08-26
Status: investigation checkpoint after Session 7

## Executive summary

The post-Session 7 Oderzo scan is substantially more conservative, but it has
regressed too far in venue, website, and resource recall. The strict admission
and validation rules correctly removed many historical false positives, yet
the live run also lost known legitimate businesses and websites such as
Barhacca and Al Giardinetto.

The main failure is upstream of resource validation. Auxiliary discovery
reported successful source runs, but web search admitted no candidates and
PagineGialle produced no candidates. Most searches fell back to Bing, whose
results were frequently unrelated to the query. Strict validation then
correctly rejected the bad results, leaving OSM as almost the sole venue
source. A correct validator cannot recover venues or websites that discovery
never supplies.

The first quality goal should therefore not be considered complete, and
Session 8 scaling work should wait. The next session should investigate search
provider behavior and design a recall-recovery plan that preserves the new
precision guarantees.

## Measured regression

Saved Oderzo scan comparison:

| Run | Total venues | Venues with resources | Official websites |
| --- | ---: | ---: | ---: |
| 2026-08-25 | 53 | 16 | 15 |
| 2026-08-26 | 42 | 2 | 3 |

The August 25 scan contained known false positives, so the raw difference is
not entirely regression. However, the August 26 scan also removed genuine
venues and official sites. The loss of Barhacca and Al Giardinetto establishes
that recall fell for known-good examples.

The August 26 source manifest reports:

| Source | Status | Raw accepted records |
| --- | --- | ---: |
| Nominatim/OSM | succeeded | 44 |
| Web search | succeeded | 0 |
| PagineGialle | succeeded | 0 |

Web admission recorded 25 rejected candidates and zero accepted candidates.
After canonicalization, the output contained 42 venues. Resource enrichment
then made 114 search requests, 45 crawl requests, and 36 resource-validation
requests, but accepted official websites for only Ca'Lozzio, I-Sushi, and
Ragazzon. Only I-Sushi and Ragazzon published resources.

This is not a lack-of-effort problem: many requests were issued, but their
inputs and stopping rules did not produce useful candidates.

## Concrete failures

### Barhacca

Barhacca was present in earlier web-discovered output with the legitimate
official website `https://www.barhacca.it/` and ordering page
`https://www.barhacca.it/ordina/`.

A cached targeted Brave search for `"Barhacca" "Oderzo" ristorante` contains
the official homepage as its seventh result, alongside directory listings that
corroborate the name and municipality. The current August 26 scan never ran
that targeted search because Barhacca was not present in the OSM candidate
backbone. Broad web discovery failed to admit it, so per-venue enrichment never
received the candidate.

This demonstrates that website enrichment cannot replace web-only venue
discovery. The two stages need different recall strategies and publication
rules.

### Giardinetto / Al Giardinetto

OSM supplied a venue named `Giardinetto`, while the known official business is
`Al Giardinetto` at `https://www.algiardinetto-oderzo.it/`. Earlier output also
contained its menu, delivery, and grilled-meat specialty pages.

The August 26 targeted query returned Bing namesakes such as Hotel Giardinetto
on Lake Orta. The selector held one of these sites for review rather than
publishing it, which is the correct precision outcome, but the search pipeline
stopped after one request. Its fallback condition currently asks whether any
search candidate passes a general relevance scorer, not whether a correct
official website has actually been accepted. A plausible wrong namesake can
therefore prevent the focused menu and loose-identity fallbacks.

The identity layer also failed to connect `Giardinetto` with `Al Giardinetto`.
The generic Italian article is not meaningful identity information, but the
current discovery path lacked address, phone, or reliable directory evidence
needed to make the alias safely.

### PagineGialle

The three Oderzo PagineGialle `site:` queries fell back to Bing and returned
unrelated pages such as Google Translate help, Reddit, and Stack Overflow.
The source completed without throwing, so its manifest status became
`succeeded`, even though it produced no relevant PagineGialle URLs.

PagineGialle should not normally be published as an official website. It is
still valuable as an independent venue, name, location, address, and phone
source and as a lead for a focused official-site search. Treating zero relevant
domain matches as ordinary success hides provider failure and discards useful
discovery coverage.

### Broad web discovery

The three broad Oderzo searches returned mostly generic restaurant directories,
iTunes/Apple results, and bar listings for Nocera Inferiore. The strict web
admission layer correctly rejected them. In contrast, a comparable Motta di
Livenza query had cached Brave results containing legitimate official websites
such as La Maison and Eccellentissimo.

The apparent town-to-town quality difference is therefore strongly influenced
by which search engine answered and whether a useful Brave response was
available in cache. It is not evidence that Motta intrinsically works while
Oderzo does not.

## Root-cause assessment

### 1. Search-provider relevance is not part of source health

The search wrapper accepts the first engine that returns parseable results.
Brave is preferred, but after rate limiting it falls through to Bing. Bing can
return confidently irrelevant results for niche local queries. A non-empty
response is cached and treated as success without checking whether results
contain the requested municipality, quoted business name, or requested domain.

Consequences:

- irrelevant results poison the 24-hour cache;
- source manifests say `succeeded` even when a provider ignored the query;
- PagineGialle can report success with zero matching-domain results;
- later validation spends requests rejecting candidates that should have
  failed an earlier provider-relevance check.

### 2. Discovery depends too heavily on broad search

Web-only venues must first appear in three broad town/category queries. If
those queries are poor, the venue is absent from the canonical candidate set
and never receives a focused name search. Barhacca is the clearest example.

### 3. Enrichment fallback stops on the wrong condition

Focused fallback searches stop when the general search-result scorer accepts
any candidate. That condition is weaker than selecting an accepted official
website for the correct venue and branch. A wrong namesake, directory, or
otherwise plausible result can stop recall-oriented fallbacks prematurely.

### 4. Directory evidence is discarded rather than used safely

Directories were correctly prevented from becoming official websites, but
their potential role as corroborating discovery evidence is underused. A
PagineGialle record matching name and municipality can justify a focused
official-site query without itself becoming a published website.

### 5. Offline fixtures under-measured coverage

The Session 5 fixture protected four known-site resource links and the Session
6/7 fixtures calibrated precision on small deterministic examples. They did
not test a live end-to-end requirement such as:

- discover Barhacca without OSM;
- merge Giardinetto with Al Giardinetto;
- recover a known official website after an irrelevant fallback-engine page;
- preserve a minimum percentage of manually labelled Oderzo websites and
  useful resources.

The offline gates therefore passed while live discovery and coverage
regressed.

## Resource-validation observations

Session 7 is not the primary cause of the low link count: resource validation
only runs after an official website is accepted, and most websites were lost
upstream. Its live output nevertheless exposed additional calibration work:

- page-wide text can override a stronger anchor/URL role, causing menu pages
  to become `specialty` and general restaurant pages to become `order`;
- reachable seasonal PDFs from 2021 and 2023 can still be published because
  reachability is checked but freshness is not;
- many discovered image candidates can be accepted internally even though the
  final per-venue cap hides most of them;
- the compact Session 7 fixture is a regression test, not sufficient evidence
  of production role precision.

These issues should be addressed after restoring the upstream website set, or
in parallel when the new live acceptance fixture makes their effect measurable.

## Required next investigation

The next session should discover further evidence before choosing an
implementation. At minimum:

1. Reproduce Brave, Bing, and cache behavior independently for the same Oderzo
   queries and record engine, HTTP outcome, relevance, and result-domain mix.
2. Determine why Brave falls back under the scan's concurrency and request
   cadence, including discovery and enrichment competition for the same
   provider.
3. Define when a non-empty result set is nevertheless an unhealthy or
   irrelevant provider response.
4. Evaluate alternative query sequences for broad venue discovery, targeted
   official-site discovery, and PagineGialle corroboration.
5. Trace every known Oderzo website through discovery, identity merge,
   official-site selection, crawl, and resource validation.
6. Inspect false negatives retained in review data and determine which missing
   evidence could be obtained safely rather than lowering publication gates.
7. Decide whether PagineGialle should be queried through search, a permitted
   direct listing path, or another discovery mechanism.
8. Measure provider request budgets so recall recovery does not create an
   uncontrolled number of searches.

## Proposed acceptance framework

Before Session 8, create a manually reviewed live Oderzo truth set with:

- known current venues, including web-only examples;
- canonical names and aliases;
- expected OSM/PagineGialle/web source relationships;
- known official websites;
- expected menu, drinks, ordering, specialty, PDF, and image links;
- explicit closed, expired, wrong-branch, and directory negatives.

Report at least:

- venue precision and recall by source class;
- web-only venue recall;
- official-website precision and recall;
- resource precision and recall by role;
- known-link retention compared with the pre-refinement scan;
- review-queue recovery potential;
- provider health, request count, and useful-results-per-query.

The release gate should combine precision and coverage. The existing precision
targets remain appropriate, but passing them with only two enriched venues is
not a successful quality outcome. A minimum known-website and known-resource
recall threshold must be added.

## Direction for the fix plan

The eventual plan will likely need to cover these principles, subject to the
next investigation:

- distinguish `request_succeeded`, `provider_relevant`, and
  `source_produced_candidates` health states;
- reject or retry irrelevant fallback-engine result sets before caching them as
  useful search responses;
- isolate provider concurrency and apply engine-specific rate limits;
- continue enrichment fallbacks until an official website is accepted or the
  explicit search budget is exhausted;
- separate broad venue discovery from official-website validation;
- use directories as corroborating evidence and search leads, never as
  automatically official sites;
- strengthen alias recovery using name variants plus address, phone,
  coordinates, or corroborating sources;
- preserve accepted historical facts across transient source failures, with
  staleness and revalidation metadata;
- make live known-good recall a blocking quality gate.

No scaling work should begin solely on the basis of the current offline
precision reports. The next checkpoint is a researched searcher fix plan and a
successful live Oderzo acceptance run.
