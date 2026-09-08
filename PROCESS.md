# One process: national venue websites

This is the only active delivery plan for restaurant-finder.

## Product shown to the operator

The national map is the product surface. It always shows the complete inventory,
including records that have no website. Every venue has exactly one visible website
state:

1. **No candidate** — the source inventory supplied no website.
2. **Candidate, unverified** — Overture or another source supplied a URL, but the
   project has not proved that it belongs to this venue.
3. **Verified** — the live page matches the venue and publisher ownership passed the
   approved verification rule.
4. **Rejected** — evidence shows that the candidate is a directory, social profile,
   unrelated publisher, conflicting venue, or otherwise not an official website.

Current baseline (2026-09-08):

- 156,057 venues in 7,398 municipalities;
- 86,852 venues with a source website candidate;
- 69,205 without a source website candidate;
- 112 verified websites;
- 6 rejected candidate domains.

Run `node ui/server.mjs` and open `http://localhost:4188/map.html`. The server uses
`data/istat/2026-01-01/derived/italy-import.sqlite` by default. Override it with
`NATIONAL_DB_PATH` only when intentionally testing another national store.

## The verification pipeline

There is one pipeline for every URL, whether it came from Overture, OSM, a chain
locator, manual correction, or paid search:

```text
venue + candidate URL
        |
        v
live crawl (no search) -> identity/geography/officialness signals
        |
        +-- contradiction, directory, social, dead replacement -> rejected or retry
        +-- insufficient evidence                         -> manual-review queue
        +-- strong first-party corroboration              -> automatic-verification rule
                                                               |
                                                               v
                                                   verified website + resources
```

Search is only a way to find a missing candidate. It is not the verifier.

The existing resolver and scorer already perform the live crawl and compute identity,
geography, and officialness. During the Brave pilots, that scorer was allowed to
publish a plausible-looking domain. It produced unacceptable false positives from
directories and third-party menu publishers. The correction added a separate
publisher-ownership attestation requirement. That stopped false publication, but it
also coupled the scorer to the ownership gate: without an attestation, a strong crawl
can only return `review`. The 86,852 candidates were consequently neither processed
nationally nor shown as candidates.

The map now fixes visibility. The next code change must decouple **automatic
corroboration** from **publication** so crawl evidence is stored and measurable even
when ownership is not yet approved.

## Execution order

### 1. Known candidates first

Run the existing crawl/scoring flow over all 86,852 source candidates with search
budgets fixed at zero. Persist the crawl result and its signals independently of the
ownership gate. Reuse cached pages and run in bounded, resumable batches.

This run sorts candidates into contradiction/retry/manual-review/strong-corroboration
buckets. It does not spend Brave requests and it does not hide unresolved venues.

### 2. Certify one automatic ownership rule

Use the already-reviewed Session 10–12 material as development data and a frozen,
previously unseen stratified subset as the final test. The proposed rule may verify a
source candidate only when all of these are true:

- the page and candidate domain are not classified as directory, booking, social,
  editorial, or generic platform content;
- the venue name is compatible;
- municipality/postcode is compatible;
- at least one high-specificity identity signal matches: normalized phone or street
  address;
- redirects and canonical URLs do not point to a conflicting publisher;
- no geography, identity, or publisher contradiction exists.

The rule ships only if the frozen test demonstrates at least 95% precision and every
false positive is reported. Until that test passes, results remain
`strongly_correlated`, not `verified`. This is the single bounded validation task;
there will be no new sequence of exploratory session plans.

If it passes, record the method as `automated_first_party_corroboration`, with the same
audit, expiry, and revalidation requirements as other attestations, then apply it to
the already-crawled strong-corroboration bucket and update the map.

### 3. Review the residual known-candidate tail

Human review is only for ambiguous/conflicting candidates and a continuing quality
sample of automatically verified results. It is not the way through all 86,852 rows.

### 4. Discover candidates for the remaining 69,205 venues

After the known-candidate run is producing verified websites, supply missing URLs in
this order:

1. OSM website/contact tags and official chain branch locators;
2. deterministic/free discovery sources that return a URL with venue identity;
3. Brave search only for the unresolved residual, under an explicit monetary budget.

Every discovered URL enters the same pipeline above. There is no second verification
architecture for Brave results.

## Current milestone and definition of done

Current milestone: **crawl and classify the 86,852 known candidates, then certify the
automatic rule on a locked holdout**.

The milestone is done only when the map reports counts for crawled, strongly
corroborated, verified, rejected, retryable, and unresolved candidates; the holdout
result is reproducible; and the national verified count materially increases. More
planning documents, tiny manual batches, or a backlog census alone do not complete it.

## Safety boundaries

- Candidate URLs remain visible but are never labelled verified prematurely.
- A timeout is retryable, not rejection.
- A plausible name or branded domain alone is never enough.
- National work is batched, resumable, cached, and audited.
- No paid search run occurs without an explicit budget.

Historical plans and reports are evidence, not instructions. Superseded top-level
plans are in `docs/archive/`; frozen evaluation artifacts remain under `benchmark/`
because integrity scripts refer to their exact paths.
