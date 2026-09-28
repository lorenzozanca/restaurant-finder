# One process: Italian venue leads for Pomovi

This is the only active delivery plan for restaurant-finder.

## Two tracks, in this order

The operator set the order on 2026-09-28: enough verified websites exist to start
selling, so the CRM comes first.

1. **Online lead CRM (primary).** The venues are the leads for Pomovi. Finish the
   private online app so that a lead becomes a Pomovi demo and moves through the
   pipeline to a customer. See "Online lead CRM" below.
2. **Website verification (secondary).** Only when the operator asks: run the
   certified reviewer over the remaining known source candidates (step 4 below) in
   approved, capped batches; later, discover candidates for venues without one (step 6).

## The map and website states

The map shows the complete inventory, including venues with no website. Every venue
has exactly one website state:

1. **No candidate**: the source inventory supplied no website.
2. **Candidate, unverified**: Overture or another source supplied a URL, but the
   project has not proved that it belongs to this venue.
3. **Verified**: the live page matches the venue and ownership passed an approved
   route: a manual review, or the frozen LLM reviewer certified on holdout v1.
4. **Rejected**: evidence shows that the candidate is a directory, social profile,
   unrelated publisher, conflicting venue, or otherwise not an official website.

The map refines unverified candidates into lead statuses: directory (unsupported
publisher), undecided (checked but not decided), unreachable (retryable crawl failure),
and not checked.

Baseline (2026-09-26, after batches `b001`–`b006`): 156,057 venues in 7,398
municipalities; 86,852 with a source website candidate and 69,205 without; 5,982
verified; 3,294 rejected; 25,818 checked candidates.

Surfaces: the online app (below) and the laptop's `node ui/server.mjs` at
`http://localhost:4188/`, which reads `data/istat/2026-01-01/derived/italy-import.sqlite`
(override with `NATIONAL_DB_PATH` only to test another store). Both serve `ui/map.html`
over `lib/national-leads.mjs` (a compact snapshot, screen-space clusters, tiles, facet
counts, list, venue card, CSV export). The laptop rebuilds the snapshot after every
publish or store change. `node ui/map-mobile-check.mjs [--url …] [--desktop]` checks
the page in headless Chrome as a phone on 4G.

Manual review happens on the venue card. An approval writes a
`manual_first_party_review` attestation plus the accepted website fact; a rejection
writes the attestation only. Reviewer batches never overwrite a manual decision. It is
the tool for the undecided tail (filter **Undecided**, work down the list).

## Online lead CRM (operator decision 2026-09-27)

This repository is Pomovi's sales CRM. It runs online and only the operator can reach
it, through Google sign-in (the pattern of the sibling `bh-os`). HubSpot was
considered and rejected: its free plan allows 10 custom properties in total, cannot
show the map or the verification state, and its strongest tool (cold email) is largely
unusable for Italian B2B prospecting. The sales motion is in person and by post.

**Split of ownership.** Each fact has exactly one owner, so sync never merges edits.

| Laptop (the verification factory) | Online (`web/`, Vercel + Neon Postgres) |
|---|---|
| Crawl, headless Chrome, LLM review batches, budget ledgers, the 1 GB evidence store | The map snapshot, per-venue review details, manual review decisions, the sales pipeline |
| Owner of automatic verification | Owner of manual decisions and every CRM record |

**Sync** (`node sync-online.mjs`, on the laptop after each publish; exact command in
`web/README.md`): 1. pull manual review decisions made online and apply them to the
local store through `recordReviewDecision`, so later reviewer batches never overwrite
them; 2. rebuild the map snapshot if the store changed; 3. push the snapshot (one
gzipped row, ~7 MB) and changed per-venue review details; 4. copy every CRM table to
`data/online-backups/` (Neon's free point-in-time restore covers only 6 hours).

**Online app** (`web/`, Next.js): Auth.js with Google only and an email allow-list
(`AUTH_OWNER_EMAILS`); `requireUser()` on every data route; `AUTH_DEV_EMAIL` for local
work, ignored in production. It serves the same `ui/map.html` and `/api/national/*` API
over the same `LeadIndex`, loaded from the newest snapshot in Neon, plus an overlay of
pending manual decisions and pipeline stages. The laptop server keeps working without
the CRM.

**Pipeline.** Stages: shortlisted, demo requested, demo ready, contacted, follow-up,
won, lost, do not contact. Every change and every touch (visit, card, letter, call,
note) is an event with a date. "Do not contact" is terminal until the operator
explicitly reopens it. The map filters by stage, and a Pipeline tab lists venues by
next action date.

**Pomovi bridge.** Keyed on this repo's `venue_id` (stored in Pomovi as
`venues.source_ref`). The online app calls Pomovi's console with a bearer token:
`POST /api/bridge/venues` creates (idempotently) a `prospect` with the lead's name and
website and returns its wizard URL; `GET /api/bridge/venues` returns each bridged
venue's status, slug, and public URL. The contract and Pomovi's side are in
`../pomovi/docs/plans/restaurant-finder-bridge.md`. This repo's client is built and
stays inactive until `POMOVI_BRIDGE_URL` and `POMOVI_BRIDGE_TOKEN` are set.

**Before real outreach:** the operator clears the items under "Second purpose, B2B
prospecting" in `PRIVACY.md` (sign the legitimate-interests assessment, add the purpose
to the public notice, record Vercel and Neon as processors) and follows its channel
rules. The Vercel project moves from Hobby (non-commercial use only) to Pro when the app
is first used to contact a venue.

**Steps.**

1. Shared code usable online (map constants and review validation without SQLite;
   `LeadIndex` overlay and stage filter). Done.
2. Neon schema (`web/db/migrations/`) and `sync-online.mjs`. Done.
3. `web/` app: Google sign-in, the map API over the Neon snapshot, manual review into
   `manual_reviews`. Done.
4. Pipeline API and UI on the venue card, stage filter, Pipeline tab. Done.
5. Pomovi client behind `POMOVI_BRIDGE_URL` and `POMOVI_BRIDGE_TOKEN`. Done (inactive).
6. Operator setup: Google OAuth, Neon (EU), Vercel (root directory `web`), first sync,
   domain `restaurants.trelua.com`. Done 2026-09-27.
7. Live checks: cold-start time of the map, and a whole-selection CSV export within
   Vercel's response limit. Open.
8. Pomovi side: the two bridge endpoints, built in the Pomovi repository following its
   plan (planned there, not implemented); then set the two variables here and create one
   real demo end to end. Open.
9. Next CRM features: to be chosen by the operator after the bridge works.

Done means: the operator signs in from a phone, sees all venues with the same counts
as the laptop map, records a manual review that reaches the local store on the next
sync, moves a venue through the pipeline, and creates its demo in Pomovi.

## Website verification

### The pipeline

There is one pipeline for every URL, whether it came from Overture, OSM, a chain
locator, manual correction, or paid search:

```text
venue + candidate URL
        |
        v
live crawl, no search (Node fetch; headless Chrome for thin, 403/429/503, TLS)
        |
        v
deterministic gates (no LLM)
        +-- directory/social/booking/platform domain -> unsupported_publisher
        +-- crawl failure or timeout                  -> retryable (never rejected)
        +-- identity/geography contradiction         -> contradicted (not publishable)
        |
        v
stage 1: cheap triage model      -> not_official (rejected) | insufficient | escalate
        |
        v
stage 2: strong verifier model   -> official | not_official | insufficient
        |
        v
deterministic acceptance of quoted evidence -> verified website + resources
```

Search is only a way to find a missing candidate. It is not the verifier.

The evidence store persists one assessment per venue/candidate URL (crawl outcome;
identity, geography, and officialness scores; evidence; origin; time), independently
of publisher attestations. The LLM stages add their own audited records on top of that
assessment (`llm_review_calls`, `llm_review_outcomes`); they never bypass it.

History: the deterministic `strict-first-party-v1` rule failed its locked holdout on
2026-09-09 (66.7% precision; false publication `lalunanelpozzo.metro.bar`). The
operator replaced it with the LLM reviewer, which was certified on 2026-09-24.

### LLM ownership reviewer specification

**Input** (the same for both stages, built from the crawl in the same pass; page text
is not stored long term): the venue record (name, aliases, street address, postcode,
municipality, province, phone), the requested URL, the final URL after redirects, the
canonical URL, the root-fallback flag, schema.org types, `tel:` links, and the page's
visible text with scripts and styles removed, capped at the frozen character budget.

**Stage 1: triage (cheap model, optional).** Returns strict JSON: `decision`
(`not_official` | `insufficient` | `escalate`), `publisher_kind`, and short reasons. It
cannot publish. `not_official` becomes `rejected`; `insufficient` stays unverified.

**Stage 2: verifier (strong model).** Returns strict JSON: `decision`
(`official` | `not_official` | `insufficient`), `publisher_kind`, and verbatim evidence
quotes for the venue name, the municipality, and at least one of the street address or
phone number.

**Deterministic acceptance.** A candidate is published only when:

- the verifier says `official`;
- every quote occurs verbatim in the page text that was sent;
- the quoted phone normalizes to the venue phone, or the quoted address matches the
  venue street and house number;
- the name and municipality/postcode are compatible;
- no deterministic contradiction or non-official publisher class exists.

Anything else stays `ambiguous`. The model cannot override a deterministic veto.

**Call settings.** Pinned exact model IDs, temperature 0, JSON-schema structured
output, and OpenRouter provider routing with `data_collection: "deny"` and
`require_parameters: true` (`zdr: true` wherever the model supports it). The verifier
must not be the model that produced the reference labels.

**Audit.** Every call persists the stage, model ID, prompt version and hash, input
hash, output JSON, token counts, `usage.cost`, and time. Automatic publications use
the attestation method `automated_llm_ownership_review`; the reviewer identity is the
verifier model ID plus the prompt version, and the evidence URL is the final URL.

**Certified configuration** (`benchmark/llm-review-holdout-v1/REVIEWER-FREEZE.json`):
`xiaomi/mimo-v2.6-pro` as verifier with no separate triage call, prompt
`llm-ownership-dev-3`. Swapping the model, prompt, or decision code makes a new
reviewer, which needs a fresh locked holdout under the protocol in step 3.
`node select-llm-models.mjs [--probe-free]` lists candidate models and their cost.

### Spending limit

Every LLM run has a hard USD cap, **default $5** (`--budget-usd`), and never above the
OpenRouter key's remaining limit. The runner loads model prices at start; before each
call it reserves the worst-case cost and refuses the call if spent plus reservation
would exceed the cap; after the call it books the reported `usage.cost`. The spend
ledger is stored with the assessments, so a resumed run keeps counting prior spend.
Reaching the cap stops the run cleanly and the work stays resumable. No LLM run starts
without an explicit cap, and Brave budgets stay separate.

### Steps

**1. Trustworthy crawl. Done 2026-09-24.** Node fetch with 2 s per address (this host
has no IPv6 route), headless Chrome (`lib/headless-browser.mjs`, DevTools protocol, no
npm dependency) for thin pages, HTTP 403/429/503, and TLS failures, and recorded
failure causes (`failure_ENOTFOUND`, `failure_http_403`, …). In production batches
25–31% of candidates end retryable, more than half of them dead domains (ENOTFOUND).

**2. Reviewer development. Done 2026-09-24.** Developed on the 200-venue corpus and
the spent v1 rule holdout (`assess-labelled-corpus.mjs --llm-review`,
`evaluate-llm-review.mjs`).

**3. Certification on a locked holdout. Passed 2026-09-24.** Protocol (applies to any
future reviewer):

1. **Source-candidate pilot (development).** Run the reviewer on a random sample of
   about 300 source-candidate venues, excluding every venue ID in prior benchmark
   artifacts, to measure the publication rate. Never reused for certification.
2. **Selection.** Draw the holdout at random, stratified by region, from the remaining
   source-candidate venues (same exclusions, disjoint from the pilot), sized so the
   expected publications are at least 1.5 × 73. Record the selection fingerprint
   before labelling.
3. **Reference labels.** An operator-chosen agent labels each venue (official website
   status plus a verdict on its candidate domain) without seeing any reviewer output
   (nothing under `data/llm-review/`). Seal the labels before the reviewer runs.
4. **Freeze.** Freeze model IDs, prompt version and hash, text budget, and code
   hashes. Then run the reviewer once on the holdout.
5. **Blind adjudication (symmetric).** A pinned adjudicator (not the labeller, not the
   reviewer) re-reviews every disagreement, seeing both claims as "A" and "B" in random
   order. Its verdict is final in either direction.
6. **Agreement audit.** The same adjudicator re-reviews a random 20% (at least 15) of
   agreed publications; any error counts as a false publication.
7. **Gate** on adjudicated labels: at least 73 correct automatic verifications; zero
   false ones; two-sided 95% Wilson precision lower bound at or above 95%; timeouts
   and inaccessible pages abstain or retry, never reject. A failed gate spends the
   holdout.

Holdout v1 result (`benchmark/llm-review-holdout-v1/`): 480 venues, seed
`locked-holdout-llm-v1`; labels by opencode with Muse Spark 1.3, sealed; one frozen
run; adjudication by DeepSeek V4 Pro. **105 correct, 0 false, Wilson lower bound
96.5%** (`ADJUDICATED-GATE-REPORT.json`).

**4. Process the known candidates. In progress, on operator request.** Crawl, gates,
and the certified reviewer over the source candidates with search at zero, in bounded,
resumable, cached batches (`prepare-national-batch.mjs`, optionally `--region CODE`),
each approved by the operator with its own cap; then `publish-national-review.mjs` and
`sync-online.mjs`. Batches `b001`–`b006` are done (Veneto complete). Runbook in
`STATUS.md`.

**5. The residual known-candidate tail.** Undecided and conflicting candidates go to
manual review on the venue card, online or on the laptop. It is not the way through all
86,852 rows.

**6. Discover candidates for the 69,205 venues without one.** After step 4, in this
order: OSM website/contact tags and official chain branch locators; free
deterministic sources that return a URL with venue identity; Brave search only for the
unresolved residual, under an explicit budget. Every discovered URL enters the same
pipeline; there is no second verification architecture for search results.

## Safety boundaries

- Candidate URLs remain visible but are never labelled verified prematurely.
- A timeout is retryable, not rejection.
- A plausible name or branded domain alone is never enough.
- A model's `official` verdict alone is never enough: its quoted evidence must pass
  the deterministic acceptance checks.
- National work is batched, resumable, cached, and audited.
- No paid search or LLM run occurs without an explicit budget.
- A manual review recorded on the live app reaches the national store on the next
  sync: never record one as a test.

Historical plans and reports are evidence, not instructions. Superseded plans are in
`docs/archive/`; frozen evaluation artifacts remain under `benchmark/` because
integrity scripts refer to their exact paths.
