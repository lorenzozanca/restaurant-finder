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
   approved verification route (manual review, or the frozen LLM reviewer certified
   on holdout v1 on 2026-09-24; see below).
4. **Rejected** — evidence shows that the candidate is a directory, social profile,
   unrelated publisher, conflicting venue, or otherwise not an official website.

Current baseline (2026-09-25, after production batches `b001`–`b004`):

- 156,057 venues in 7,398 municipalities;
- 86,852 venues with a source website candidate;
- 69,205 without a source website candidate;
- 4,455 verified websites (112 earlier plus 4,343 from the certified reviewer);
- 2,562 rejected candidates;
- 20,000 persisted national candidate assessments (66,616 eligible venues remain).

Run `node ui/server.mjs` and open `http://localhost:4188/map.html`. The server uses
`data/istat/2026-01-01/derived/italy-import.sqlite` by default. Override it with
`NATIONAL_DB_PATH` only when intentionally testing another national store.

## Route decision (2026-09-24)

The deterministic `strict-first-party-v1` rule failed its locked holdout on
2026-09-09 (2 correct and 1 false publication; 66.7% precision, 20.8% Wilson lower
bound; false publication `lalunanelpozzo.metro.bar`). The operator has replaced the
hand-written rule route with an **LLM ownership reviewer** called through
OpenRouter: a cheap model triages every crawled candidate, and a stronger model
performs the ownership check on the candidates the cheap model escalates.

The operator accepts OpenAI/Codex agent reviews as the reference labels for
development and for the new locked holdout. No human audit sample is required.
The existing labels were produced that way: the 1,000-venue Session 12 holdout
adjudications are signed `Codex independent bounded-fixture review`.

## The verification pipeline

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

Schema v5 already persists one assessment per venue/candidate URL (crawl outcome;
identity, geography, and officialness scores; evidence; origin; time) independently
of publisher attestations. The LLM stages add their own audited records on top of
that assessment; they never bypass it.

## LLM ownership reviewer specification

**Input** (the same for both stages, built from the crawl in the same pass; page
text is not stored long term): the venue record (name, aliases, street address,
postcode, municipality, province, phone), the requested URL, the final URL after
redirects, the canonical URL, the root-fallback flag, schema.org types, `tel:` links,
and the page's visible text with scripts and styles removed, capped at a fixed
character budget chosen in development and then frozen.

**Stage 1: triage (cheap model).** Returns strict JSON: `decision`
(`not_official` | `insufficient` | `escalate`), `publisher_kind` (official venue,
directory, booking/ordering platform, social, editorial, public body, unrelated
business, parked/dead), and short reasons. It **cannot publish**. `not_official`
becomes `rejected`, and the holdout reports its false-rejection count.
`insufficient` stays unverified.

**Stage 2: verifier (strong model).** Returns strict JSON: `decision`
(`official` | `not_official` | `insufficient`), `publisher_kind`, and verbatim
evidence quotes for the venue name, the municipality, and at least one of the street
address or phone number.

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
`require_parameters: true` (`zdr: true` wherever the chosen model supports it). The
verifier must not be the same model that produced the reference labels.

**Audit.** Every call persists the stage, model ID, prompt version and hash, input
hash, output JSON, token counts, `usage.cost`, and time. Automatic publications use
the attestation method `automated_llm_ownership_review`. The reviewer identity is
the verifier model ID plus the prompt version, the evidence URL is the final URL,
and expiry and revalidation follow the other attestations.

## Model selection

Benchmarks nominate models; our own development data decides.

1. `node select-llm-models.mjs [--probe-free]` lists OpenRouter models with structured
   output, their cost per 1,000 reviews, and, when `ARTIFICIAL_ANALYSIS_API_KEY` is set,
   the Artificial Analysis intelligence index (attribution required). `--probe-free`
   checks at zero cost which free models answer under `data_collection: "deny"`. On
   2026-09-24 only `nex-agi/nex-n2.5-mini:free` and
   `dots-studio/dots-3-note-preview:free` could be pinned. The others need
   OpenRouter's "free model training" setting, which this project does not enable.
2. A nominated model is tried in a capped development run and compared on false
   publications, false rejections, and cost per candidate.
3. Operator choice (2026-09-24): `xiaomi/mimo-v2.6-pro` for both roles, so development
   runs skip the separate triage call and send every reviewable candidate to MiMo. The
   free triage model `nex-agi/nex-n2.5-mini:free` contradicted itself in `dev-1`
   (publisher "official venue site", decision "not official"). Meta Muse Spark 1.3
   Contributor ($0.10/$0.20 per M) is refused under `data_collection: "deny"` (Meta
   trains on its prompts). The full Muse Spark 1.3 ($1.25/$4.25 per M) is allowed but
   would cost about 8× MiMo per verification.
4. Certification freezes exact model IDs. Swapping either model later is a new
   reviewer. It needs a fresh locked holdout slice, because comparing many models
   on one holdout would select on noise.

## Spending limit

Every LLM run has a hard USD cap, **default $5** (`--budget-usd`). The runner loads
OpenRouter model prices at start. Before each call it reserves the worst-case cost
(input estimate plus `max_tokens` at the pinned prices) and refuses the call if
spent plus reservation would exceed the cap. After the call it books the reported
`usage.cost`. The spend ledger is stored with the assessments, so a resumed run
keeps counting prior spend. Reaching the cap stops the run cleanly; the work stays
resumable. As a backstop, the operator also sets an OpenRouter API-key credit
limit. No LLM run starts without an explicit cap, and Brave budgets stay separate.

## Execution order

### 1. Make the crawl trustworthy — done 2026-09-24, re-measure pending

- 1,113 of the 2,804 v1-holdout candidates (40%) failed as transport failures. On
  re-probing 120 of them, about half were sites that curl loads but Node rejected
  after its 250 ms per-address connect race (this host has no IPv6 route).
  `lib/lib.mjs` now allows 2 s per address; 56/120 then loaded, 54/120 were 403 bot
  walls (almost all directories, which are rejected anyway), and ~7% were
  unreachable.
- `lib/headless-browser.mjs` renders thin/script-only pages, HTTP 403/429/503, and
  TLS-chain failures in the installed Chrome over the DevTools protocol, with no
  npm dependency. The previous "rendered" fallback was only a second plain fetch.
- Crawl failures now record their cause (`failure_ENOTFOUND`, `failure_http_403`,
  …). Dead DNS is not retried at the root.
- Pending: re-measure the success rate on a random national candidate sample over a
  healthy network. The 2026-09-24 link was saturated (~20 KB/s).

### 2. Build and develop the LLM reviewer — core implemented 2026-09-24, development continuing

Implemented and tested: `lib/openrouter-client.mjs` (budget cap), `lib/llm-ownership-reviewer.mjs`
(both stages, optional triage, deterministic acceptance), evidence-store schema v6
(`llm_review_calls`, `llm_review_outcomes`), `assess-labelled-corpus.mjs --llm-review`,
`evaluate-llm-review.mjs`, and `select-llm-models.mjs`. Develop prompts, the text budget, and model choice
on the 200-venue development corpus. Because the v1 holdout (1,000 venues) can no
longer qualify anything, it may also be used as development data. Every
development run is capped (default $5) and reports publications, false
publications, false rejections, abstentions, and cost per candidate.

### 3. Certify on a new locked holdout

Protocol fixed 2026-09-24, before any new holdout is selected or labelled:

1. **Source-candidate pilot (development).** Run the reviewer on a random sample of
   about 300 venues with a source (Overture) website, excluding every venue ID in
   prior benchmark artifacts. It measures the publication rate on the production
   population and exposes source-URL-specific failures. It is development data and
   is never reused for certification.
2. **Selection.** Draw the holdout at random, stratified by region, from the
   remaining source-candidate venues (same exclusions, disjoint from the pilot). Size
   it from the pilot's publication rate, so the expected number of publications is at
   least 1.5 × 73. Record the selection fingerprint before labelling.
3. **Reference labels.** An agent the operator runs manually on a subscription (for
   example Claude or Codex, strongest available model, with web research) labels each
   holdout venue: official website status plus a verdict on its candidate domain. It
   works in sessions that never see the reviewer's output (nothing under
   `data/llm-review/`). This is the operator's choice (2026-09-24) and replaces
   labelling by OpenAI models through OpenRouter. For holdout v1 the operator asked
   that one session do all packets: it spawns one fresh-context Claude subagent per
   packet, whose prompt names only `LABELLING-INSTRUCTIONS.md` and its packet and
   forbids reading any other repository file. The spawning session only validates and
   commits the files and changes no reviewer code, prompt, or setting after seeing
   them. Seal the labels before the reviewer runs.
4. **Freeze.** Freeze the reviewer's model IDs, prompt version and hash, text budget,
   and code hashes. Then run it once on the holdout.
5. **Blind adjudication (symmetric).** A pinned adjudicator re-reviews every
   disagreement between reviewer and label: a reviewer publication whose domain is not
   label-verified (including `uncertain` labels), and every candidate the reviewer
   rejected while the label verifies it. The adjudicator (an operator-run agent in a fresh session that
   did not produce the labels; not the MiMo reviewer) receives the venue record, the live
   page text, and both claims as "A" and "B" in random order, without knowing which is
   the label. Its verdict is final in either direction.
6. **Agreement audit.** The same adjudicator also re-reviews a random 20% (at least
   15) of publications where reviewer and label agree. Any error it finds counts as a
   false publication.
7. **Gate** on adjudicated labels:
   - at least 73 correct automatic verifications;
   - zero false automatic verifications;
   - two-sided 95% Wilson precision lower bound at or above 95%;
   - timeouts and inaccessible pages abstain or retry, never reject.
   The report also gives raw-label metrics, every overturned label with its evidence,
   false rejections, and cost per candidate.

A failed gate spends that holdout, exactly as v1 did.

Pilot result (2026-09-24, `pilot-dev-3`, 300 source-candidate venues, seed
`source-pilot-2026-09-24`): 156 candidates reviewed, 71 accepted (a 23.7% venue
publication rate), 36 rejected, 49 ambiguous; 83 retryable; $0.1828; 6 minutes. At
23.7%, a 480-venue holdout expects about 114 publications (at least 1.5 × 73).
The pilot drew from a single stratum because `region` was empty in the source
records; the selector now uses `region_code` (20 regions).

Holdout selected (2026-09-24): 480 venues across 20 regions, seed
`locked-holdout-llm-v1`, fingerprint `440ad0df…caae1`, in
`benchmark/llm-review-holdout-v1/` with 10 labelling packets and
`LABELLING-INSTRUCTIONS.md`. Labelled by opencode with Muse Spark 1.3 (operator's
choice) and sealed in `LABELS-SEAL.json` (216 verified, 181 rejected, 83 uncertain).

Evidence for this protocol: in `v1h-dev-3` (spent v1 holdout, development use),
all 5 publications counted false against raw Codex labels were label errors. Four
showed the record's exact phone and address on the venue's own domain; the fifth
domain was itself labelled verified.

### 4. Process the known candidates

Only after the gate passes, run crawl, gates, and the reviewer over all 86,852
source candidates with search budgets fixed at zero. Use bounded, resumable,
cached batches, each with an explicit USD cap, and expose the progress counts on the
map.

### 5. Review the residual known-candidate tail

Ambiguous and conflicting candidates, plus a continuing quality sample of automatic
verifications, go to agent review. It is not the way through all 86,852 rows.

### 6. Discover candidates for the remaining 69,205 venues

After the known-candidate run is producing verified websites, supply missing URLs in
this order:

1. OSM website/contact tags and official chain branch locators;
2. deterministic/free discovery sources that return a URL with venue identity;
3. Brave search only for the unresolved residual, under an explicit monetary budget.

Every discovered URL enters the same pipeline above. There is no second verification
architecture for Brave results.

## Map and lead interface (operator priority from 2026-09-25) — delivered 2026-09-25

Step 4 is parked until the operator tops up OpenRouter (batches `b001`–`b002` done).
Meanwhile the national map becomes a fast, mobile-first lead browser. Measured on
2026-09-25: the first request blocked 6.8 s to build the index; a zoomed-in Rome view
sent 800 KB and a "roma" search 2 MB of uncompressed GeoJSON; clusters were a fixed
degree grid with up to 2,500 DOM markers; only one status filter existed.

1. **Data layer.** A compact map snapshot, rebuilt after each publish and whenever the
   national store changes (in a worker, never blocking requests), loads in about
   1 s. Supercluster-style clustering in screen space (60 px), stable
   while panning, with an expansion zoom per cluster. Map data is served as
   cached, versioned tiles drawn on canvas; venue details are loaded on tap; responses
   are gzip-compressed. Targets: at most 50 ms server time per request and at most
   30 KB per screen.
2. **Filters and samples.** Region → province → municipality, name search, category
   (7 Overture types), lead status (verified, rejected, checked but unresolved,
   unreachable, not yet checked, no website), has phone. Facet counts in view and in
   total, filter state in the URL, a list of venues in view, and a CSV export of the
   whole selection or a seeded random sample (with Overture attribution).
3. **Mobile-first page.** Full-screen map, floating search, filter chips, a draggable
   bottom sheet (counts / list / filters or details), tap-to-call, touch targets of
   at least 44 px, safe-area insets, and Leaflet served locally. On desktop the sheet
   becomes a side panel.
4. **Verification.** Tests for count conservation across zooms and tile edges, for filter
   counts against the store, and for response-size budgets; a mobile-emulation run
   (headless Chrome, phone viewport, 4G throttling) with timings and screenshots.

Result (2026-09-25): all four steps are implemented. On a Pixel 7 viewport over
throttled 4G (150 ms RTT, 9 Mbit/s), clusters and counts appear 1.1 s after navigation.
A whole session of search, list, venue card, filters and street zoom moved 47 KB of map
data (tiles plus API), against 800 KB–2 MB per view before. Server side: tiles are
answered in under 1 ms, counts and lists in about 15 ms, and the snapshot loads in 1.7 s
at startup (building it takes about 9 s, in a worker).

### Manual review on the venue card (2026-09-25)

The town scanner (`ui/index.html`) and the separate review page (`ui/review.html`) are
retired; `/` redirects to the map. Manual ownership review, the other approved
verification route, now happens on the map's venue card, against the national store:
the card shows the crawl assessment, the LLM reviewer's reason and quotes (from
`data/national-review/review.sqlite`, or `NATIONAL_REVIEW_DB_PATH`), and earlier
attestations. An approval writes a `manual_first_party_review` attestation plus the
accepted website fact; a rejection writes the attestation only. The map snapshot is
rebuilt immediately. `publish-national-review.mjs` never overwrites a manually decided
venue or domain. This is the working tool for step 5 (the residual tail): filter to
**Undecided** and review down the list.

## Current milestone and definition of done

Current milestone: continue step 4 (process the 86,852 known candidates with the
certified reviewer; `b001`–`b004` done) in operator-approved batches. The reviewer passed the adjudicated holdout-v1 gate on 2026-09-24 (105
correct, 0 false, Wilson lower bound 96.5%).

The milestone is done only when the frozen reviewer passes the new locked holdout.
The whole route is delivered only when the map reports counts for crawled, strongly
corroborated, verified, rejected, retryable, and unresolved candidates, and the
national verified count materially increases. More planning documents, tiny manual
batches, or a backlog census alone do not complete it.

## Safety boundaries

- Candidate URLs remain visible but are never labelled verified prematurely.
- A timeout is retryable, not rejection.
- A plausible name or branded domain alone is never enough.
- A model's `official` verdict alone is never enough: its quoted evidence must pass
  the deterministic acceptance checks.
- National work is batched, resumable, cached, and audited.
- No paid search or LLM run occurs without an explicit budget.

Historical plans and reports are evidence, not instructions. Superseded top-level
plans are in `docs/archive/`; frozen evaluation artifacts remain under `benchmark/`
because integrity scripts refer to their exact paths.
