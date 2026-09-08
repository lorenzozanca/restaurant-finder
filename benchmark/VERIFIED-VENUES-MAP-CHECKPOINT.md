# Verified-venues map checkpoint

Date: 2026-09-07
Status: **first verified map live locally; 106/156,057 venues verified**
Brave requests used: **0** (whole day)
Publication authorized: **yes — ownership-gated only** (Session 12 policy:
publish nothing without an active venue-scoped attestation)

## What changed

The national store went from 0 to **185 active publisher attestations**
across 185 distinct venues, all imported from already-completed independent
reviews — no new review judgments, no policy change, no frozen Session 11/12
artifact modified (read-only):

- Session 10 redone + fresh selections via existing
  `queue-ops ownership-import`: 17 + 21.
- Session 11 development (10 files), Session 11 final holdout (5 files),
  Session 12 cohort 1 (6 files) and cohort 2 (5 files) via new
  `benchmark/import-web-stress-attestations.mjs` (+test): 29 + 22 + 44 + 52.
- Pre-import audit: 147 unique accepted venues, zero cross-file duplicates,
  zero venue IDs missing from the national store. One format fix: reviews
  sometimes duplicate an evidence URL and the store requires uniqueness, so
  the importer dedupes deterministically (pinned by a new test).

## Pipeline fix found by the data: attested-first crawl

Crawl-only enrichment of the 185 attested venues first yielded only 57
websites: the resolver crawled the *source* website and never tried the
*attested* URL (45 venues carry a social/directory source website and were
skipped with 0 crawls). `resolveOfficialSite` now tries actively attested
websites before the source website and before any search
(`attested_ownership` origin, recorded in crawl attempts and provenance);
`find-menu.mjs` feeds them from `publisher_ownership`. With no attestations
the new loop is a no-op. Re-running the 128 fact-less venues recovered 49
more — total **106 verified websites, 66 with resources (real menu PDFs
included), 0 search requests** across all runs.

The remaining 79 attested venues stay unpublished: 50 rejected and 29 review
on live page signals (dead/changed pages, weak branch corroboration) plus
the social-source cases whose attested crawl did not corroborate. The gate
holds: review evidence plus an unconvincing live page still abstains.

## Map

- `node export-verified-map.mjs --db <store> --output <file>` (+test):
  exports attested website facts with coordinates, menu links, and
  provenance as GeoJSON. Non-attested, non-factual, and coordinate-less
  venues are excluded by construction.
- `ui/map.html` (served by the existing UI server, new `.geojson` content
  type): Leaflet map of `ui/verified-venues.geojson` — 106 pins, green with
  menu / blue website-only, popups with official-site and menu links, OSM +
  Overture attribution. Verified locally:
  `GET /map.html → 200 text/html`, `GET /verified-venues.geojson → 200
  application/geo+json`, 106 features served.
- Run with `node ui/server.mjs` → http://localhost:4188/map.html
  (town scanner unchanged at `/`).

## Verification

- `node --test`: **222/222 pass** (212 baseline + 10 new).
- `git diff --check`: clean. Production queues untouched except the intended
  attestation + fact writes (jobs still queued; a future worker must check
  `findReusableEvidence` before re-crawling factual venues).
- Safety: 1 GB pre-write backup at `/tmp/national-backup-2026-09-07.sqlite`;
  all sample/scratch HTTP caches in `/tmp`; `output/.cache` untouched;
  frozen Session 11/12 evaluation artifacts byte-untouched.

## Next (attestation supply, most-certain first)

1. Registry crosswalk after the `DATA-LICENSING.md` review (INI-PEC /
   Registro Imprese domains → `official_registry` attestations) — the only
   track that can add thousands without per-venue human review.
2. Small review-queue UI on top of `queue-ops ownership-*` so each further
   human attestation is one evidence-backed click; re-export + refresh the
   GeoJSON after every batch (`export-verified-map.mjs` already supports it).
3. Backlog layers on the map (unverified density) only after the verified
   layer grows; wholesale queue crawling stays off until the worker honors
   reusable evidence.

## Continuation — 2026-09-08

The registry licensing review is complete and supersedes item 1 above: there
is no lawful zero-cost bulk INI-PEC / Registro Imprese track. INI-PEC may be
consulted manually for one venue, but an own-domain PEC is only a candidate
hint and cannot create an ownership attestation by itself. See
`DATA-LICENSING.md`.

The next operational track is therefore the local ownership review queue at
`/review.html`. Start it against the national store with:

```sh
EVIDENCE_DB_PATH=data/istat/2026-01-01/derived/italy-import.sqlite node ui/server.mjs
```

The queue presents stored website candidates one venue/domain at a time with
minimised source and crawl evidence. Approve/reject writes a durable human
review attestation only; it never publishes a fact. Rejected domains leave
other candidate domains for the venue reviewable. `official_registry` is not
available as a review-queue method. After a reviewed batch, crawl only newly
attested venues and regenerate `ui/verified-venues.geojson`.

The first agent-assisted batch and its crawl-only follow-up are complete:
**190 verified / 6 rejected attestations, 108 accepted website facts, and 108
map features (67 with menus), with zero Brave requests**. The phone-review UX
fix, decision log, five-venue crawl outcomes, safety backup, and next operating
loop are recorded in
[`benchmark/AGENT-ASSISTED-REVIEW-BATCH-2026-09-08.md`](AGENT-ASSISTED-REVIEW-BATCH-2026-09-08.md).

Agent-assisted batch 2 approved and live-crawled three exact first-party
matches: McDonald's Alpignano, Pizzeria Napoli, and Locanda Il Pomo d'Oro.
The national state is now **193 verified / 6 rejected attestations, 111
accepted website facts, and 111 map features (69 with menu URLs)**. The crawl
again used zero search requests, all 156,057 national jobs remain queued, and
ambiguous candidates were left undecided. Evidence, abstentions, backup, fact
deltas, and the dated-event-menu caveat are recorded in
[`benchmark/AGENT-ASSISTED-REVIEW-BATCH-2-2026-09-08.md`](AGENT-ASSISTED-REVIEW-BATCH-2-2026-09-08.md).
