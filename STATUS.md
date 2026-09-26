# Execution status

Updated: 2026-09-26 (Veneto batch `b005` published; 5,979 verified)
Branch: `main`

## Current milestone

Process the 86,852 known candidates with the certified reviewer (`PROCESS.md` step 4),
in operator-approved batches with a $5 cap each (about 5,000 venues nationally, or one
whole region with `--region`). The reviewer
passed the adjudicated holdout-v1 gate on 2026-09-24 (105 correct, 0 false).

## Locked holdout v1 for the LLM reviewer (2026-09-24)

- Selected (`PROCESS.md` step 3.2) with the command in the previous next task:
  480 venues, seed `locked-holdout-llm-v1`, 86,616 eligible source-candidate venues,
  2,376 venue IDs excluded (2,076 from `benchmark/` plus the 300 pilot venues; overlap
  with the pilot checked: 0). Stratified across all 20 regions (`region_code`).
  Selection fingerprint
  `440ad0dfa6b1db0bcbb6a3ef6a33e840d7e87b570978dd5eee44ce235eecaae1`. Fixture and
  manifest: `benchmark/llm-review-holdout-v1/locked-holdout-001-480.json`,
  `selection-manifest.json`. No crawl or reviewer call has touched these venues.
- Labelling packets: `prepare-holdout-labelling.mjs` wrote 10 packets of 48 venues to
  `benchmark/llm-review-holdout-v1/labelling/` (plus `packets-manifest.json` with
  hashes). Each carries the same venue record the reviewer receives (via the now
  exported `loadTargetEvidence`), the exact candidate URL, and its registrable domain.
  4 of 480 venues have no phone; all have an address.
- `benchmark/llm-review-holdout-v1/LABELLING-INSTRUCTIONS.md`: task, independence
  rules (never read `data/llm-review/` or other repo files; no MiMo), what counts as
  official, the output format (existing adjudication schema plus a required
  `rationale` per domain review, optional `final_url` and
  `other_official_website_url`), and a worked example.
- `validate-holdout-labels.mjs` checks each label file against the fixture and its
  packet (exact venue set, rationale present, labeller is not MiMo); `--complete`
  requires all 10 batches; `--seal` writes an immutable `LABELS-SEAL.json` with
  file hashes. `validate-holdout-labels.test.mjs` validates the instruction example
  block itself, so the documented format cannot drift from the validator.
- Fixed before the freeze: `evaluate-llm-review.mjs` scored a publication by the
  domain of the crawl's final URL, so a candidate that redirected to an unlabelled
  domain counted as false. It now scores such a publication against the candidate
  domain's label (the labeller judges whether the venue controls the redirect); a final
  domain that has its own label is still scored by that label.
  `evaluate-llm-review.test.mjs` fails on the old code and passes now; `dev-3`
  development metrics are unchanged (20 publications, 16 true, 0 false).
- Labelling (operator decision, 2026-09-24): instead of ten manual sessions, the
  operator asked this session to do all packets. It spawned ten fresh-context Claude
  subagents, one per packet, each told to read only the instructions and its packet
  (`PROCESS.md` step 3.3). `validate-holdout-labels.mjs --file` checks one batch so
  the agents do not trip over each other's partial files. The operator stopped the run
  because it took their Claude usage from 0% to 75%. All ten were stopped with **0
  label files written**: 10 parallel agents contended for the network (DNS failures,
  slow fetches) and one hit an API timeout. Operator chose a zero-LLM prefetch: `prefetch-holdout-pages.mjs` crawls each
  candidate plus one contact page and keeps ~1.5 KB identity excerpts in
  `data/holdout-labelling/pages-AAA-BBB.json` (gitignored). Trial on packet 001-048:
  only 5/48 fetched (36 connect timeouts) because the Wi-Fi association had degraded
  again (rx VHT-MCS 0; see the network diagnosis below). After the operator reconnected
  (rx 325 Mbit/s), the full run fetched 328/480 candidates: 77 ENOTFOUND, 39 HTTP 403,
  23 HTTP 404, 5 HTTP 5xx, 3 TLS certificate errors, 5 connection errors or timeouts.
  Contact pages were found for only 16 venues. Excerpts average 579 characters per
  venue (~28 KB per packet).

- Labels done and sealed (2026-09-24): the operator chose opencode with
  `opencode/muse-spark-1.3-contributor-free` (free; Meta may train on the prompts,
  which contain only public business data). `label-holdout-with-opencode.mjs` ran one
  packet at a time under a $10 cap, measured from the opencode OpenRouter key: 3–6
  minutes per packet, $0.00 total. Each agent read the instructions, its packet, and
  the prefetched excerpts, and searched the web for failed or unclear venues.
  `node validate-holdout-labels.mjs --complete`: 480 venues; domain verdicts 216
  verified, 181 rejected, 83 uncertain. `LABELS-SEAL.json` records the file hashes.
  Nothing from the reviewer has been run on these venues.

- Holdout run `holdout-v1` (2026-09-24, once, frozen per
  `REVIEWER-FREEZE.json`; MiMo v2.6 Pro, prompt dev-3; $2 cap): crawl 135 strongly
  correlated, 109 ambiguous, 41 contradicted, 146 retryable, 49 unsupported; 244
  reviewed (105 accepted, 62 rejected, 77 ambiguous); 0 provider errors; $0.2946.
  **Raw** metrics against the sealed labels (`RAW-EVALUATION.json`): 105 venue
  publications, 105 correct, 0 false; Wilson 95% lower bound 96.5%; recall 105/216
  (48.6%); 2 false rejections. The raw numbers meet all three gate thresholds, but
  the gate is decided on adjudicated labels: steps 3.5–3.6 are still open (blind
  adjudication of the 2 false rejections; agreement audit of a random 21 of the 105
  publications by a model that is neither MiMo nor Muse Spark). Not certified yet.
- **Adjudicated gate: PASSED** (`ADJUDICATED-GATE-REPORT.json`, `adjudicate-holdout.mjs`;
  DeepSeek V4 Pro via opencode, 4 parallel groups, $0.0971 total incl. one rerun of a
  group whose verdict file was malformed JSON). Agreement audit: 21 of 105 publications,
  0 errors, 0 uncertain. Both disputed rejections were adjudicated official (2 real
  false rejections). Final: 105 correct, 0 false, Wilson lower bound 96.5%. The frozen
  reviewer (`REVIEWER-FREEZE.json`) is certified for `PROCESS.md` step 4.

## Mobile-first lead map (PROCESS.md "Map and lead interface", 2026-09-25)

- Operator priority while batches are parked. Before: 6.8 s blocking index build on the
  first request, 800 KB (Rome zoom) to 2 MB ("roma" search) of uncompressed GeoJSON,
  fixed-degree grid clusters with up to 2,500 DOM markers, one status filter.
- Shipped:
  - `lib/map-snapshot.mjs` + `build-map-snapshot.mjs`: a columnar snapshot
    (`italy-import.map-snapshot.json`, 32 MB, gitignored) with one lead status per
    venue. The statuses are verified, rejected (both from attestations only), directory
    (unsupported publisher), undecided, unreachable (retryable, with the failure code),
    not checked, and no website. `publish-national-review.mjs` rebuilds it after
    publishing.
  - `lib/national-map-service.mjs`: loads the snapshot at server start. When the store
    changes it rebuilds the snapshot in a worker thread (`lib/map-snapshot-worker.mjs`)
    while the old index keeps answering.
  - `lib/map-cluster.mjs`: supercluster-style clustering over zooms 4–16, 60 px
    screen radius, weighted centroids, and an expansion zoom per cluster, bucketed by
    512 px tile.
  - `lib/national-leads.mjs`: filters (status, category, region, province, phone,
    name), a 12-entry cluster cache per filter set, tiles, facet counts, the list, venue
    details, municipality lookup, and CSV export (whole selection or a seeded sample,
    with Overture attribution).
  - `ui/server.mjs`: `/api/national/{meta,tile/z/x/y,summary,list,venue/i,locate,export.csv}`,
    gzip, and versioned immutable tiles. The old `/api/national-map` and its grid code
    are removed. `NATIONAL_DB_PATH` no longer falls back to `EVIDENCE_DB_PATH`.
  - `ui/map.html`, rewritten: full-screen map, floating search, status chips with
    counts, a canvas tile layer (green arc = verified share), a draggable bottom sheet
    (list / filters / venue card with call, website, maps), URL state, a side panel on
    desktop, and Leaflet 1.9.4 served from `ui/vendor/` (hashes match the SRI values
    in the since retired `index.html`).
  - `ui/map-mobile-check.mjs [--desktop]`: a headless Chrome check (phone viewport,
    touch, 4G), with screenshots in `output/map-check*/`.
  - `PRIVACY.md` registers the snapshot and CSV exports.
- Measured (real store, 156,057 venues; lead statuses sum to 156,057): 2,265 verified,
  1,289 rejected, 837 directory, 2,606 undecided, 2,933 unreachable, 76,938 not
  checked, 69,189 no website.

## Old pages retired; manual review on the venue card (2026-09-25)

- Operator decision: retire the town scanner and the separate review page, and move
  manual review into the map.
- Removed: `ui/index.html` (town scanner, its scan-based "Italy" tab and history; its
  scan button could spend Brave queries with no USD cap), `ui/review.html` (read a
  separate `EVIDENCE_DB_PATH` store in venue-ID order and needed the GeoJSON export),
  `ui/verified-venues.geojson`, `export-verified-map.mjs` and its test, and the
  `/api/scan*`, `/api/map`, `/api/review/*` endpoints. `/`, `/index.html` and
  `/review.html` redirect to `/map.html`. `discover.mjs` stays as a command-line tool.
- Added:
  - `GET /api/national/review/:i`: candidates, active attestations, crawl assessments,
    and the latest LLM reviewer outcome (reason, quotes) for one venue
    (`venueReview` in `lib/review-queue.mjs`; 17 ms on the real store).
  - `POST /api/national/review`: `recordReviewDecision` against the national store.
    The candidate domain must belong to the venue; an approval publishes
    (`EvidenceStore.publishManuallyVerifiedWebsite`: `manual_first_party_review`
    attestation plus the accepted website fact the map requires); a rejection records
    the attestation only. The server then rebuilds the map snapshot
    (`NationalMapService.storeChanged`, which also re-runs a build that was already
    in progress).
  - `ui/map.html`: a "Why this status" section and a **Review this website** form on
    every venue card with a website. The reviewer name is remembered on the device.
  - `publish-national-review.mjs` now also skips reviewer outcomes on any domain with a
    manual decision, so a manual rejection is never overwritten by a later publish.
- Freeze note: `lib/evidence-store.mjs` (hashed in `REVIEWER-FREEZE.json`) changed
  additively again: the new `publishManuallyVerifiedWebsite` method. The reviewer's
  decision code, prompt, and settings are unchanged.
- National counts unchanged by this work (no decision was recorded on the real store):
  2,265 verified, 1,289 rejected, 2,606 undecided, 10,000 assessed, 156,057 venues.

## Map search fix (2026-09-26)

- Operator report: typing in the map's search box froze the app on a phone at the first
  letter. Cause: the box was bound to a native `<datalist>` of all 7,894 municipalities.
  Mobile browsers match it by substring and build their native suggestion popup from
  every match (thousands of rows for one letter). Headless Chrome shows no such popup,
  so the freeze does not reproduce there: typing took about 20 ms per letter.
- Fix: the datalist is gone. `ui/map.html` keeps its own town list and shows at most 8
  towns plus a "Venues named …" row. Matching ignores accents and case, puts name
  prefixes before later-word prefixes, and ranks towns by venue count (for "trev",
  Treviso comes first, not Trevenzuolo). Rows are 44 px touch targets; the arrow keys,
  Enter, and Escape work, and the box has combobox ARIA. The ranked list comes from
  the new `GET /api/national/towns` (`LeadIndex.towns()`: name, province, venue count;
  7,398 towns, 57 KB gzipped, fetched once on focus). The filter panel no longer
  overwrites text being typed when the town list arrives.
- `ui/map-mobile-check.mjs` now types "trev" letter by letter, times each keystroke,
  and taps the Treviso suggestion instead of submitting the form from a script.
- Not yet confirmed on the operator's real phone.

## Production pipeline for the 86,852 candidates (PROCESS.md step 4)

- Built 2026-09-24 (commit `8722786`; `npm test` 266 passed, 0 failed):
  `prepare-national-batch.mjs --size N` writes the next N source candidates (fixed
  SHA-256 order of venue IDs, so every batch is spread nationally) into
  `data/national-review/batches/bNNN/` for the unchanged frozen runner;
  `publish-national-review.mjs` copies the review database's assessments and
  frozen-reviewer outcomes into the national store (accepted -> verified website as an
  `automated_llm_ownership_review` attestation plus the accepted website fact; rejected
  -> rejected candidate). It backs up the national store once
  (`italy-import.pre-llm-publish.sqlite`), is idempotent, skips outcomes from any other
  model or prompt, and never overrides a manual verification.
- Freeze note: the reviewer's decision code is unchanged, but two files hashed in
  `REVIEWER-FREEZE.json` changed additively: `lib/evidence-store.mjs` (new method
  allowed only with `source_kind: certified_llm_review`, new `publishLlmVerifiedWebsite`)
  and `lib/publisher-ownership.mjs` (the new method counts as verified).
- Batch `b001` (5,000 venues) is prepared. Its first run was stopped at once because the
  Wi-Fi had degraded again (rx VHT-MCS 0, 5.3 s to Google): nothing was saved, $0 spent.
- **Batch `b001` completed and published (2026-09-25).** Link checked first (rx
  VHT-MCS 5, 0% loss, ~11 ms RTT). Run `national-b001`, frozen reviewer (MiMo v2.6
  Pro, prompt `llm-ownership-dev-3`), $5 cap, concurrency 12: 5,000 candidates in
  58 minutes (05:51–06:49 UTC, ~86/min). Crawl: 1,338 strongly correlated, 1,157
  ambiguous, 552 contradicted, 1,491 retryable, 462 unsupported publisher. Review:
  2,495 candidates, 1,094 accepted, 626 rejected, 775 ambiguous; 0 provider errors;
  $2.7385 ($0.0011 per review). Retryable causes: 840 ENOTFOUND (dead domains), 276
  HTTP 404, 173 HTTP 403, 34 timeouts, 32 HTTP 500, 23 connect timeouts, 18
  EAI_AGAIN, others fewer than 15 each.
  `publish-national-review.mjs`: 5,000 assessments, 1,090 verified
  (`automated_llm_ownership_review`), 626 rejected, 4 skipped because they were
  already manually verified, 0 from an unfrozen reviewer.
- National counts after `b001`, read from `/api/national-map` on a fresh server:
  **1,202 verified** (was 112), **632 rejected** (was 6), **5,000 assessed** (was 0),
  86,852 source candidates, 69,205 without a candidate, 156,057 venues.
- `prepare-national-batch.mjs` now also skips venues that already have an assessment in
  the national store (commit `9a5f569`; `prepare-national-batch.test.mjs`), so losing
  the gitignored batch folders cannot cause a venue to be crawled and reviewed twice.
  Its eligible population is 86,616 venues (the selector's rule; 236 fewer than the
  map's 86,852 source candidates).
- **Batch `b002` completed and published (2026-09-25).** Link rx VHT-MCS 7. Run
  `national-b002`, same frozen settings and $5 cap: 5,000 new venues (none overlapping
  `b001`) in 71 minutes (06:58–08:09 UTC). Crawl: 1,304 strongly correlated, 1,212
  ambiguous, 532 contradicted, 1,506 retryable, 446 unsupported publisher. Review:
  2,516 candidates, 1,064 accepted, 657 rejected, 795 ambiguous; 0 provider errors;
  $2.8616. Retryable causes: 850 ENOTFOUND, 297 HTTP 404, 160 HTTP 403, 39 timeouts,
  29 HTTP 500, 27 EAI_AGAIN. `publish-national-review.mjs` (cumulative):
  2,153 verified, 1,283 rejected, 5 skipped as already manually verified.
- National counts after `b002`, read from `/api/national-map` on a fresh server:
  **2,265 verified**, **1,289 rejected**, **10,000 assessed**, 86,852 source
  candidates, 69,205 without a candidate, 156,057 venues. 76,616 eligible venues
  remain for later batches. LLM spend on production batches: $5.60.
- **Batch `b003` completed and published (2026-09-25).** The operator asked to continue.
  The OpenRouter account had credit again, but the API key's own limit had only $3.01
  left, so the cap was **$2.95** (below the key limit, so the run stops cleanly). The Wi-Fi
  had fallen to rx VHT-MCS 0 (16 KB/s); `nmcli connection up "Italia Uno"` (no sudo
  needed) restored it. Under crawl load it fell back to MCS 0 three more times
  (RTT 0.7–4.6 s) and was reconnected each time. Run `national-b003`, frozen settings,
  concurrency 12: first pass 5,000 candidates (finished 20:25 local), 1,240 reviewed, 37
  OpenRouter transport timeouts, $1.51. A second pass with `--retry-state retryable` (same
  run ID, same cap) re-crawled 2,734 of the 3,012 retryable candidates, re-sent the
  timed-out reviews, and stopped at the cap (`budget_exhausted`, $2.92 spent in total).
  b003 crawl: 1,293 strongly correlated, 1,186 ambiguous, 529 contradicted, 1,534
  retryable, 458 unsupported publisher. Review: 2,477 candidates, 1,097 accepted, 604
  rejected, 776 ambiguous (2 reviewable candidates lack an outcome; ~278 retryable were
  not re-crawled before the cap). Retryable causes: 850 ENOTFOUND, 251 HTTP 404, 161 HTTP
  403, 102 EAI_AGAIN (DNS failures during the degraded link), 45 timeouts.
  `publish-national-review.mjs` (cumulative): 3,249 verified, 1,885 rejected, 8 skipped as
  already manually verified, 0 from an unfrozen reviewer.
- National counts after `b003`, read from `/api/national/meta` on a fresh server:
  **3,361 verified**, **1,891 rejected**, **15,000 assessed**, 86,852 source candidates,
  69,205 without a candidate, 156,057 venues. Lead statuses: 3,361 verified, 1,891
  rejected, 1,250 directory, 3,893 undecided, 4,439 unreachable, 72,034 not checked,
  69,189 no website. 71,616 eligible venues remain. LLM spend on production batches:
  $8.52. The API key has $0.24 left of its $10 limit.
- **Batch `b004` completed and published (2026-09-25).** The operator raised the key limit
  to $25 and approved another batch. Link reconnected first (MCS 0 → MCS 8). Run
  `national-b004`, frozen settings, $5 cap, concurrency 12. The first process stopped at
  925/5,000 (21:49 local) when the Claude session that launched it ended; it was resumed
  under the same run ID as a detached process (`setsid nohup`) together with a detached
  Wi-Fi watchdog (reconnect when RTT to 1.1.1.1 exceeds 500 ms). The watchdog never had
  to act. The resumed run finished at 22:53 (4,058 assessed, 942 resumed). No retry pass
  was needed: 0 provider errors and only 15 EAI_AGAIN.
  b004 crawl: 1,333 strongly correlated, 1,233 ambiguous, 538 contradicted, 1,447
  retryable, 449 unsupported publisher. Review: 2,566 candidates (every reviewable one),
  1,098 accepted, 672 rejected, 796 ambiguous; $2.98. Retryable causes: 842 ENOTFOUND,
  270 HTTP 404, 166 HTTP 403, 34 timeouts, 29 HTTP 500.
  `publish-national-review.mjs` (cumulative): 4,343 verified, 2,556 rejected, 13 skipped
  as already manually verified, 0 from an unfrozen reviewer.
- National counts after `b004`, read from `/api/national/meta` on a fresh server:
  **4,455 verified**, **2,562 rejected**, **20,000 assessed**, 86,852 source candidates,
  69,205 without a candidate, 156,057 venues. Lead statuses: 4,455 verified, 2,562
  rejected, 1,664 directory, 5,212 undecided, 5,858 unreachable, 67,117 not checked,
  69,189 no website. 66,616 eligible venues remain. LLM spend on production batches:
  $11.50. The API key has $12.35 left of its $25 limit.

- **Batch `b005`: all of Veneto (2026-09-26).** The operator asked to finish Veneto
  instead of a national 5,000. `prepare-national-batch.mjs --region CODE` (ISTAT region
  code; `05` = Veneto) now limits a batch to one region; the certified runner is
  unchanged. `b005`: 5,796 venues, every remaining Veneto source candidate (1,755 had
  been in `b001`–`b004`). Run `national-b005`, frozen settings, $5 cap, concurrency 12,
  detached with the Wi-Fi watchdog (it never had to act).
  - The first process stopped at 525/5,796 (11:49): `ristorantestorione.it` is a thin page
    whose meta refresh points at a dead domain, so headless Chrome ended on its own error
    page and `lib/headless-browser.mjs` returned it as a 200 with final URL
    `chrome-error://chromewebdata/`. The store refused that URL, the error rejected the
    worker pool, and the process then hung on shutdown instead of exiting. Fix: a render
    whose final page is not http(s) is now a failed render (`client_redirect_failed`).
    Three such renders cached as successes (two from 25 Sep) were deleted from
    `data/national-review/cache`. The hung process and its Chrome were killed and the run
    resumed under the same run ID (528 resumed, 5,268 assessed, 12:13–13:13).
  - b005 crawl: 1,805 strongly correlated, 1,355 ambiguous, 664 contradicted, 1,434
    retryable, 538 unsupported publisher. Review: 3,160 candidates, 1,527 accepted, 729
    rejected, 904 ambiguous; 0 provider errors; $3.43. Retryable causes: 727 ENOTFOUND,
    322 HTTP 404, 142 HTTP 403, 42 timeouts, 35 HTTP 500, 30 EAI_AGAIN, 27 connect
    timeouts, 27 TLS name mismatches. No retry pass (few transient failures).
  - `publish-national-review.mjs` (cumulative): 5,867 verified, 3,285 rejected, 16 skipped
    as already manually verified, 0 from an unfrozen reviewer.
  - Map fix found while checking Veneto: the map joined assessments to venues by the raw
    source URL, but batches store the normalized candidate (no fragment or tracking
    parameters, sorted query). 445 assessed venues nationally (124 in Veneto) showed
    "Not checked yet". `lib/national-map.mjs` now normalizes with the batch rule.
    Verified and rejected are matched by domain and were not affected.
  - Freeze note: `lib/headless-browser.mjs` (hashed in `REVIEWER-FREEZE.json`) changed
    for the render fix above. The reviewer's decision code, prompt, model, and settings
    are unchanged.
- National counts after `b005`, read from `/api/national/meta` on a fresh server:
  **5,979 verified**, **3,291 rejected**, **25,796 assessed**, 86,852 source candidates,
  69,205 without a candidate, 156,057 venues. Lead statuses: 5,979 verified, 3,291
  rejected, 2,350 directory, 6,862 undecided, 7,409 unreachable, 60,977 not checked,
  69,189 no website. **Veneto** (13,073 venues): 1,966 verified, 928 rejected, 687
  directory, 2,057 undecided, 1,914 unreachable, 22 not checked, 5,499 no website. The
  22 have a source URL without a scheme (`www.…`), which the batch selector
  (`loadRows`, `LIKE 'http%'`) excludes everywhere. 60,820 eligible venues remain. LLM
  spend on production batches: $14.93. The API key has $8.93 left of its $25 limit.

## LLM reviewer core and first development runs (2026-09-24)

- Implemented and tested (fake transports, zero spend):
  - `lib/openrouter-client.mjs`: reserves the worst case before each call, books
    `usage.cost`, hard-stops at `--budget-usd`, and counts prior spend on resume.
  - `lib/llm-ownership-reviewer.mjs` (prompt `llm-ownership-dev-3`): optional triage,
    verifier, deterministic quote acceptance, and a guard so a self-contradictory
    "own site but not official" answer never becomes a rejection.
  - Evidence-store schema v6: `llm_review_calls` and `llm_review_outcomes`. These
    never create publisher attestations.
  - `assess-labelled-corpus.mjs --llm-review --run-id --budget-usd --verifier-model
    [--triage-model] [--verifier-reasoning] [--verifier-max-tokens]`, which reads the
    key from `.env` as `OPENROUTER`.
  - `evaluate-llm-review.mjs` and `select-llm-models.mjs`.
- Models: the operator chose `xiaomi/mimo-v2.6-pro` for both roles. Only two free
  models can be pinned under `data_collection: "deny"`. Muse Spark 1.3 Contributor
  is refused (Meta trains on its prompts), and full Muse Spark 1.3 costs about 8× MiMo.
- Live smoke test: free triage plus MiMo verifier accepted a synthetic page with all
  four quotes checked, for $0.000546.
- Development runs on the 200-venue / 987-candidate corpus (local
  `data/llm-review/development-run-1.sqlite`; labels in `benchmark/session-11-web`):
  - `dev-1` (free Nex triage, then MiMo; prompt dev-1): 33 candidates reviewed.
    2 venue publications, both correct, 0 false; 2 false rejections, both from the
    triage self-contradiction that is now guarded. Cost $0.0118.
  - `dev-2` (MiMo only; prompt dev-2; stopped at 125/335 when a latency test paused
    its process): 36 reviewed. 1 publication, correct, 0 false; 3 false rejections,
    all McDonald's corporate pages that the labels accept as the chain's official
    domain. Prompt dev-3 now treats brand/chain sites that don't identify the branch
    as "insufficient". Cost $0.0285.
  - `dev-3` (MiMo only; prompt dev-3; completed after the Wi-Fi fix, retrying earlier
    timeouts): 193 candidates reviewed across 96 venues (34 accepted, 124 rejected,
    35 ambiguous). Venue publications: 20, of which 16 have a verified label, all 16
    correct and 0 false; the other 4 venues are labelled `uncertain` by Codex, and each
    was accepted with a matched phone or street address on the venue's own domain
    (pennylanetavern.com, oltregusto.it, hoteldolomiticastelmezzano.com,
    lefolliedellochef.com). Precision 16/16, Wilson lower bound 80.6% (too few
    publications for the 73-publication gate). Recall 16/29 labelled official sites
    (55%). 0 false rejections. 30 labelled-official candidates were left ambiguous,
    mostly McDonald's PDFs with no extractable text and chain pages that don't name the
    branch. Cost $0.2298 for 193 calls ($0.0012 per review; about 2,490 prompt and 290
    completion tokens per call); 1 invalid output.
  - Throughput after the fix: 303 candidates crawled and 173 reviewed in 7.5 minutes at
    concurrency 8 (about 40 candidates/min), with RTT to 1.1.1.1 at about 7 ms during
    the run. Retryable candidates fell from 250 to 97.
  - Total LLM spend after `dev-3`: about $0.30 of the operator's $2 first-try limit.
- Development run `v1h-dev-3` on the spent v1 holdout (1,000 venues, 2,804 candidates;
  development use only; prompt dev-3; MiMo only; local
  `data/llm-review/v1-holdout-development.sqlite`):
  - Crawl: 2,804 candidates in 21.5 minutes at concurrency 12 (~130/min): 385 strongly
    correlated, 209 ambiguous, 166 contradicted, 520 retryable, 1,524 unsupported
    publisher.
  - Review: 594 candidates across 363 venues (116 accepted, 417 rejected, 61 ambiguous);
    0 provider errors; 4 invalid outputs. Cost $0.7060 ($0.0012 per review).
  - Venue metrics against the Codex labels: 70 publications, 57 conclusive, 52 correct,
    5 counted false (Wilson 81.1%–96.2%). Recall 52/96 (54%). 6 candidate-level false
    rejections: 2 JustEat white-label sites and 1 leggimenu-hosted menu (the verifier
    calls these ordering/menu platforms), 2 pages that were "Account Suspended" at
    crawl time, and 1 "Don Vittò Pizza e Sfizi" judged a different venue. 43
    labelled-official candidates were left ambiguous.
  - All 5 counted false publications look like label errors, not reviewer errors:
    - `palazzocircolone.it` (Bar Cittadino) and `presu.it` (Presù – Ciarcia Experience)
      are the venues' own Overture website URLs, and the quoted phone and address match
      the record.
    - `agriturismolaterrazza.com` and `agriturismodipetruintoni.it` show the exact
      record name, address/contrada, and phone.
    - `peterland.it` is itself labelled `verified` official; the strict metric counts
      it false only because the labeller named `peterlandolbia.it` as *the* official URL.
    - The Codex labels carry no notes explaining these rejections.
- Source-candidate pilot `pilot-dev-3` (`PROCESS.md` step 3.1; development only):
  300 venues selected by `select-source-sample.mjs` (seed `source-pilot-2026-09-24`;
  86,616 eligible; 2,076 benchmark venue IDs excluded; fixture in
  `data/llm-review/source-pilot/`). Crawl: 85 strongly correlated, 71 ambiguous,
  33 contradicted, 83 retryable, 28 unsupported. Review: 156 candidates; 71 accepted
  (23.7% of venues), 36 rejected, 49 ambiguous; 0 provider errors; $0.1828; 6 minutes
  at concurrency 12. No labels exist for the pilot, so precision is not measured here.
  The sample was not region-stratified (empty `region` field), which is now fixed.
- `openai/gpt-6-sol` (probe: routes to OpenAI under `data_collection: "deny"` only with
  `temperature` omitted; the client now accepts `temperature: null`). Superseded: the
  operator chose Claude, not OpenAI via OpenRouter, for labels and adjudication.
- Total LLM spend to date: about $1.19 of the operator's $2 first-try limit.

- Network diagnosis (resolved 15:27 UTC): the bottleneck was the laptop's Wi-Fi
  association, not the internet line. After 52 hours connected on DFS channel 124,
  the router was sending to the laptop at VHT-MCS 0 (15 Mbit/s) with 2.9 M dropped
  frames against 1.45 M received. A 250-packet load to the router gave 3.5 s RTT
  with 15% loss, and internet throughput was ~20 KB/s, which any crawl saturated.
  Wi-Fi power saving off: no change. `sudo nmcli connection up "Italia Uno"`
  (operator) restored the link: rx 390 Mbit/s, the router load test at 2.6 ms with
  0% loss, and 100 MB downloaded in 1.96 s (53.5 MB/s). If crawls slow down again,
  check the `rx bitrate` in `iw dev wlp58s0 station dump` and reconnect.

## Route decision and crawler work (2026-09-24)

- Operator decision: the automatic route is now an LLM ownership reviewer through
  OpenRouter (cheap triage model → stronger verifier → deterministic acceptance of
  quoted evidence). OpenAI/Codex agent reviews are accepted as reference labels,
  with no human audit sample. Every LLM run has a hard USD cap, default $5.
  `PROCESS.md`, `AGENTS.md`, and `PLAN.md` record the route; the reviewer core
  followed later the same day (section above).
- `DATA-LICENSING.md` and `PRIVACY.md` register OpenRouter and the upstream model
  providers as processors. Requests must set `data_collection: "deny"` and
  `require_parameters: true` (`zdr: true` where supported). Only hashes, decisions,
  short quotes, and cost are kept.
- Crawl-failure diagnosis: 1,113 of 2,804 v1-holdout candidates were transport
  failures. This host has no IPv6 route, and Node's 250 ms per-address connect race
  failed slow sites that curl loads. After the fix (`lib/lib.mjs`, 2 s per address),
  a re-probe of 120 of those failures gave 56 × 200, 54 × 403 (almost all directory
  bot walls: tuttiaffari, cylex, justeat, deliveroo…), 8 unreachable, one 404, and one 429.
- New `lib/headless-browser.mjs` drives the installed Google Chrome 152 over the
  DevTools protocol, with no npm dependency (npm registry calls hang on this host).
  It returns the rendered DOM, main-document status, and final URL, and waits for
  client-rendered text to stop growing. A live check turned a Wix page from 67 into
  3,177 visible characters. Cloudflare challenge pages still return 403 (expected).
- `find-menu.mjs`: `crawlWebsiteCandidate` now renders pages that are thin once
  scripts and styles are removed, or that answer HTTP 403/429/503 or fail on a TLS
  chain. Crawl results carry `rendered` and `failure_reason`, and retryable evidence
  gains `failure_<code>`. `ENOTFOUND` no longer retries the site root.
  `assess-labelled-corpus.mjs` uses the Chrome renderer with a cache (`--no-headless`
  opts out). The pre-existing `getRendered` in `lib/lib.mjs` is still only a
  second plain fetch for other callers.
- Not measured: the production-scale success rate. During this session the link ran
  at ~20 KB/s. Two 132-URL national samples were dominated by connect timeouts
  (62/132 and 64/132 succeeded), so neither is evidence for or against the fix.
- National counts are unchanged: 0 candidate assessments, 112 verified, 6 rejected.

## Completed and visible

- National inventory: 156,057 venues in 7,398 municipalities.
- National map: `http://localhost:4188/map.html` via `node ui/server.mjs`.
- Map states (after `b005`, 2026-09-26): 86,852 source candidates, 5,979 verified
  websites, 3,291 rejected candidates, 25,796 assessed candidates, and 69,205 venues
  without a source candidate.
- The map supports municipality/venue search, municipality autocomplete, status
  filters, national clustering, and individual venue details.
- Map clusters (2026-09-13): numeric grid counts at every zoom until close-up.
  Cell size halves about every zoom level (1.0° at z≤5 down to 0.008° at z≥13),
  so far-away views show plain counts (224 clusters / ~50KB for all Italy at
  z6) instead of one chip per venue; an adaptive pass caps output at 2,500
  clusters. Individual dots appear only at z≥12 with ≤2,000 venues in view
  (search capped at 2,000 with `truncated=true`). Clicking a count zooms to
  its cell bounds. No admin name chips: badges are fixed-size circles
  (36/46/58px) with the count only and no per-cluster popups.
- Map loader (2026-09-13): source rows are read with SQL `json_extract` instead
  of parsing the ~4KB provenance blobs in JS; index load ~10s → ~6.5s for
  156,057 venues / 86,852 candidates, follow-up viewport queries 15–160ms.
- Map frontend (2026-09-13): `moveend` is debounced 250ms with in-flight abort;
  the status line reads "N venues in M clusters — click a cluster to zoom in".
- The main UI Map navigation opens the national inventory map.
- `PROCESS.md` is the sole active plan. Superseded direction documents are preserved
  under `docs/archive/`; frozen benchmark evidence remains under `benchmark/`.
- `AGENTS.md` makes this ledger and the canonical process mandatory session context.
- Evidence-store schema v5 persists one assessment per venue/candidate URL with its
  crawl outcome; identity, geography, and officialness scores; evidence; origin; and
  checked time, independently of publisher attestations and accepted facts.
- The scorer distinguishes `strongly_correlated`, `ambiguous`, `contradicted`,
  `retryable`, and `unsupported_publisher`. Strong correlation without ownership
  remains unpublished.
- The national map/API reports assessment counts and exposes the assessment and three
  scores for each assessed source candidate. The real national store is migrated to
  schema v5 and currently contains 0 assessments because no national crawl has run.
- The zero-search labelled-corpus runner persists resumable candidate assessments in
  a dedicated local database and can join minimized locked-holdout fixtures to the
  national venue identity data without reading their adjudications.
- The 200-venue development corpus is fully crawled: 987 candidate outcomes comprise
  42 strongly correlated, 65 ambiguous, 30 contradicted, 214 retryable, and 636
  unsupported-publisher assessments. The development-only strict first-party rule
  made 7 correct publications, 0 false publications, and 193 abstentions (precision
  100%; two-sided 95% Wilson lower bound 64.57%).
- The rule, crawler, evaluator, development report/database hashes, and locked
  holdout artifact hashes are frozen in
  `benchmark/AUTOMATIC-FIRST-PARTY-RULE-FREEZE.json`. Search and Brave are disabled.
- The frozen locked-holdout crawl completed all 2,804 persisted candidate outcomes
  across 1,000 venues: 45 strongly correlated, 58 ambiguous, 18 contradicted, 1,159
  retryable, and 1,524 unsupported publisher. Of the retryable outcomes, 1,113 were
  transport failures; inaccessible candidates abstained and were not rejected.
- The one authorized locked-label evaluation was executed and is now spent. The v1
  rule failed every acceptance condition: 3 conclusive publications versus the
  required 73; 1 false publication versus the allowed 0; and 66.7% precision with a
  20.8% two-sided 95% Wilson lower bound versus the required 95%. The 1 false
  publication was the rejected booking/order platform
  `https://lalunanelpozzo.metro.bar/?lang=en`. The immutable evaluation report is
  `benchmark/AUTOMATIC-FIRST-PARTY-LOCKED-HOLDOUT-EVALUATION-V1.json`.
- The v1 automatic rule is not approved. No automatic ownership attestations were
  created, the national store still has 0 candidate assessments, and the
  86,852-candidate production crawl remains unauthorized.

## Verified facts about the old method

- The 14-venue Oderzo acceptance did not generalize.
- National pilots achieved only 41.7% and 35.7% official-website precision.
- The later 1,000-venue result tested an agent-reviewed ownership gate (labels signed
  `Codex independent bounded-fixture review`): 96 verified publications, zero false
  publications, and 904 abstentions. It did not validate an automatic ownership
  classifier.
- The 86,852 source candidates already exist and need no Brave search.
- A 20-venue zero-search crawl sample fetched 18 candidates but published zero because
  automatic crawl evidence cannot currently create an ownership attestation.

## Next executable task

Veneto is done (`b005`). The map server on port 4188 (started before this change) must be
restarted to pick up the map join fix; until then it shows 445 checked venues as "Not
checked yet". Report any map issue as a fix before resuming batches. Manual reviews of
undecided venues (filter **Undecided**, e.g. 2,057 in Veneto) need no budget.

Batch `b006` needs the operator's approval and their choice of scope (national 5,000, or
one region with `--region CODE`). The API key has $8.93 left of its $25 limit; a
5,000-venue batch costs about $3 (`b005`, 5,796 venues, cost $3.43). Once approved:

1. Check the link (`iw dev wlp58s0 station dump`: rx bitrate well above VHT-MCS 0; ping
   1.1.1.1 under 50 ms). If degraded, run `nmcli connection up "Italia Uno"` (works
   without sudo).
2. `node prepare-national-batch.mjs --size 5000 [--region CODE]` (writes `b006`), then:
   `node assess-labelled-corpus.mjs --partition development --fixture-dir data/national-review/batches/b006 --venue-db data/istat/2026-01-01/derived/italy-import.sqlite --db data/national-review/review.sqlite --cache-dir data/national-review/cache --concurrency 12 --llm-review --run-id national-b006 --budget-usd 5 --verifier-model xiaomi/mimo-v2.6-pro`
   with a cap below the key's remaining limit, logging to `data/national-review/b006.log`.
   Launch it detached (`setsid nohup bash -c '…; echo "exit $?" >> …log' &`) with the
   detached Wi-Fi watchdog (every 30 s, ping 1.1.1.1 five times; if the average is above
   500 ms or all are lost, run the `nmcli` command, at most once per 2 minutes; stop when
   the log has its `exit` line). Watch for a stalled log, not only for the `exit` line: a
   worker error rejects the pool and the process can hang instead of exiting. If the link
   dropped (many EAI_AGAIN or connect timeouts, or provider errors), rerun once with
   `--retry-state retryable` (same run ID and cap).
3. `node publish-national-review.mjs` (also rebuilds the map snapshot), then read
   `/api/national/meta` (`stats` and `statuses`) and report the verified, rejected, and
   assessed counts.

## Acceptance gate for the automatic verifier (unchanged from v1)

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.
- Also reported: stage-1 false rejections and cost per candidate.

## Last verification

- Veneto batch `b005`, render fix, map join fix (2026-09-26):
  - `npm test`: 276 passed, 0 failed. `git diff --check`: clean.
  - `node --test lib/headless-browser.test.mjs`: the new meta-refresh-to-dead-site case
    fails on the old renderer (`ok: true`) and passes now. A live render of
    `https://www.ristorantestorione.it/` now returns `ok: false`, final URL the page itself.
  - `node --test lib/national-map.test.mjs`: the new fragment/tracking-query case fails on
    the old join and passes now.
  - Reproduction before the fix: the runner without `--llm-review` on the 12 in-flight
    venues (scratch database, shared cache) failed with "candidate assessment requires
    valid candidate and final URLs" on `venue:024116:vicenza:del-mare`.
  - `node prepare-national-batch.mjs --size 10000 --region 05`: `b005`, 5,796 venues,
    `previously_done` 1,755, `remaining_after` 0.
  - `node assess-labelled-corpus.mjs ... --run-id national-b005 --budget-usd 5 ...`
    (resumed after the fix): 5,268 assessed, 528 resumed, `reviewed_total` 3,160, 0
    provider errors, $3.4261, `stopped_reason: null`.
  - `node publish-national-review.mjs`: `{"assessments":25796,"verified":5867,"rejected":3285,"skipped_manual":16,"skipped_unfrozen":0}`;
    `node build-map-snapshot.mjs` after the join fix: 156,057 venues.
  - `PORT=4197 node ui/server.mjs`: `GET /api/national/meta` verified 5,979, rejected
    3,291, assessed 25,796, lead statuses sum to 156,057; `GET /api/national/summary?region=05`
    as above (22 not checked).
  - OpenRouter `GET /api/v1/key`: limit $25, remaining $8.93.

- Map search fix (2026-09-26):
  - `npm test`: 274 passed, 0 failed. `git diff --check`: clean.
  - `GET /api/national/towns` on the real store: 7,398 towns, first
    `["Roma","RM",7016]`, 175 KB raw / 57 KB gzipped, about 10 ms.
  - `node ui/map-mobile-check.mjs --url http://127.0.0.1:4199/map.html` (Pixel 7, 4G):
    all checks passed; keystrokes 26–34 ms each (to the second animation frame), 9
    suggestion rows for "trev" with Treviso first, tapping it moved the map to Treviso
    with the box reading "Treviso (TV)". `--desktop`: all checks passed.
  - An ad-hoc headless probe: "forli" → Forlì first; clearing the box hides the list;
    "Venues named “pizzeria da”" filtered to `?q=pizzeria+da` (1,284 venues);
    ArrowDown + Enter on "venez" jumped to Venezia (VE).

- Batch `b004` (2026-09-25; no code changed):
  - `node prepare-national-batch.mjs --size 5000`: `b004`, 5,000 venues,
    `previously_done` 15,000, `remaining_after` 66,616.
  - `node assess-labelled-corpus.mjs ... --run-id national-b004 --budget-usd 5 ...`
    (first process stopped at 925; resumed detached): 4,058 assessed, 942 resumed,
    `reviewed_total` 2,566, 0 provider errors, $2.9797, `stopped_reason: null`.
  - `node publish-national-review.mjs`: `{"assessments":20000,"verified":4343,"rejected":2556,"skipped_manual":13,"skipped_unfrozen":0}`;
    map snapshot rebuilt (156,057 venues).
  - `PORT=4197 node ui/server.mjs`, `GET /api/national/meta`: verified 4,455, rejected
    2,562, assessed 20,000, no_candidate 69,205; lead statuses sum to 156,057.
  - OpenRouter `GET /api/v1/key`: limit $25, remaining $12.35.

- Batch `b003` (2026-09-25; no code changed):
  - `node prepare-national-batch.mjs --size 5000`: `b003`, 5,000 venues,
    `previously_done` 10,000, `remaining_after` 71,616.
  - `node assess-labelled-corpus.mjs ... --run-id national-b003 --budget-usd 2.95 ...`:
    5,000 assessed, 1,240 reviewed, 37 provider errors, $1.5135.
  - The same command plus `--retry-state retryable`: 2,734 assessed (1,988 resumed),
    1,237 reviewed, 0 provider errors, `reviewed_total` 2,477, $2.9200 for the run,
    `stopped_reason: budget_exhausted`.
  - `node publish-national-review.mjs`: `{"assessments":15000,"verified":3249,"rejected":1885,"skipped_manual":8,"skipped_unfrozen":0}`;
    map snapshot rebuilt (156,057 venues).
  - `PORT=4197 node ui/server.mjs`, `GET /api/national/meta`: verified 3,361, rejected
    1,891, assessed 15,000, no_candidate 69,205; lead statuses sum to 156,057.
  - OpenRouter `GET /api/v1/key`: limit $10, remaining $0.24.

- Old pages retired, review on the venue card (2026-09-25):
  - `npm test`: 274 passed, 0 failed (three runs; an earlier run had 1 failure in the
    unchanged `lib/lib.test.mjs` PDF-body test, the known flaky one). `git diff
    --check`: clean.
  - `node --test ui/server.test.mjs lib/review-queue.test.mjs publish-national-review.test.mjs`
    cover the redirects, the review GET/POST (invalid JSON, invented domain, wrong
    method, missing store → 503), an approval turning an undecided venue verified after
    the snapshot rebuild, corrected sites, and manual precedence in publishing.
  - `node ui/map-mobile-check.mjs --url http://127.0.0.1:4199/map.html` (real store,
    Pixel 7, 4G; now also opens an undecided venue's review without submitting): all
    checks passed; review details in 575 ms, form opens, `/` and `/review.html`
    redirect. `--desktop`: all checks passed (review details 118 ms).
  - Browser end-to-end on a throwaway fixture store: a decision without a name is
    refused; an approval showed "Verified" at once, and the map updated after 3.0 s
    (verified 1 → 2, undecided 1 → 0).

- Lead map (2026-09-25):
  - `npm test`: 273 passed, 0 failed. `git diff --check`: clean.
  - `node build-map-snapshot.mjs`: 156,057 venues in 8,793 ms. Load in a fresh
    process: 1,714 ms and 150 MB heap. Full cluster build: 780 ms. Tile queries:
    under 1 ms and at most 1.1 KB. Summary and list: 13–18 ms. Filtered cluster
    builds: 7–43 ms.
  - `node ui/map-mobile-check.mjs --url http://127.0.0.1:4191/map.html` (Pixel 7,
    4G): all checks passed; clusters and counts at 1,139 ms; list 216 ms; venue card
    212 ms. A bubble tap zoomed 5 → 6. Veneto + verified = 232. Map data for the whole
    session: 32.6 KB of tiles and 14.9 KB of API. The `--desktop` run passed, with the
    bubble tap zooming 6 → 7.
  - `curl .../api/national/export.csv?status=verified`: 2,265 rows plus the header.
    The seeded sample was byte-identical on repeat. A full export took 1.0 s.

- Batch `b002` and batch picker (2026-09-25):
  - `node --test prepare-national-batch.test.mjs`: 1 passed. `npm test`: 267 passed,
    0 failed. `git diff --check`: clean. With `batches/b001` moved aside, a 5,000-venue
    selection overlapped the 5,000 assessed venues 0 times.
  - `node prepare-national-batch.mjs --size 5000`: `b002`, 5,000 venues,
    `previously_done` 5,000, `remaining_after` 76,616.
  - `node assess-labelled-corpus.mjs ... --run-id national-b002 --budget-usd 5 ...`:
    5,000 assessed, 2,516 reviewed, `stopped_reason: null`, 0 provider errors, $2.8616.
  - `node publish-national-review.mjs`: `{"assessments":10000,"verified":2153,"rejected":1283,"skipped_manual":5,"skipped_unfrozen":0}`.
  - `GET /api/national-map?zoom=6` (fresh server): verified 2,265, rejected 1,289,
    assessed 10,000.

- Batch `b001` (2026-09-25; no code changed):
  - `node assess-labelled-corpus.mjs ... --run-id national-b001 --budget-usd 5 ...`:
    5,000 assessed, 2,495 reviewed, `stopped_reason: null`, 0 provider errors, $2.7385.
  - `node publish-national-review.mjs`: `{"assessments":5000,"verified":1090,"rejected":626,"skipped_manual":4,"skipped_unfrozen":0}`.
  - `PORT=4191 node ui/server.mjs`, `GET /api/national-map?zoom=6`: stats venues
    156,057, source_candidates 86,852, verified 1,202, rejected 632, no_candidate
    69,205, assessed 5,000.

- Locked holdout selection and labelling packets (2026-09-24):
  - `node select-source-sample.mjs ... --count 480 --seed locked-holdout-llm-v1 ...`:
    480 selected, 86,616 eligible, 2,376 excluded, fingerprint `440ad0df…caae1`.
  - `node prepare-holdout-labelling.mjs --fixture benchmark/llm-review-holdout-v1/locked-holdout-001-480.json --db data/istat/2026-01-01/derived/italy-import.sqlite --output-dir benchmark/llm-review-holdout-v1/labelling`:
    10 packets, 480 unique venues, 4 missing phones, 0 missing addresses.
  - `node validate-holdout-labels.mjs --holdout-dir benchmark/llm-review-holdout-v1`:
    0 batches, 10 packets (no labels yet).
  - `node --test validate-holdout-labels.test.mjs`: 2 passed. `npm test`: 263 passed,
    0 failed. `git diff --check`: clean.

- LLM reviewer (2026-09-24):
  - `npm test`: 261 passed, 0 failed.
  - `git diff --check`: clean.
  - Live calls: the smoke test ($0.000546), `dev-1`, and `dev-2` as recorded above;
    `node evaluate-llm-review.mjs ... --run-id dev-1|dev-2` produced the figures above.
  - `node select-llm-models.mjs --probe-free`: 358 structured-output models. Free
    models routable under `data_collection: "deny"`: `nex-agi/nex-n2.5-mini:free`,
    `dots-studio/dots-3-note-preview:free`, and `openrouter/free` (a router, so not
    pinnable).


- Crawler and renderer (2026-09-24):
  - `node --test lib/headless-browser.test.mjs find-menu.test.mjs assess-labelled-corpus.test.mjs`:
    49 passed, 0 failed. This includes a live Chrome render of a local server
    (redirect → final URL, text inserted by JavaScript after 300 ms, 404 status)
    and crawler tests for 403, TLS, script-only, and ENOTFOUND handling.
  - `npm test`: 249 tests. The first run had 248 passed and 1 failed: `get does not
    load PDF or image bodies into text memory` (`lib/lib.test.mjs`, unchanged; it
    passes alone before and after this change and shares a fixed `/tmp` cache dir).
    Two reruns: 249 passed, 0 failed.
  - Connect-race check: `https://www.lidoauroracampomarino.it/` and
    `https://www.palazzosantelena.it/servizi/` failed with ETIMEDOUT after ~260 ms
    under Node's default settings and returned 200 with a 2,000 ms attempt timeout
    or with autoselection disabled; `curl -6` fails immediately on this host.
  - `git diff --check`: clean.

Earlier (2026-09-13):

- Map cluster verification (2026-09-13, real national store):
  - `node --test lib/national-map.test.mjs`: 4 tests passed (candidate
    visibility, numeric counts far / dots up close with count conservation,
    clusters kept at mid zoom, dense-area cap plus search truncation).
  - `npm test`: 245 tests passed, 0 failed.
  - Direct index check: z5 all-Italy 77 clusters / 17KB, z6 224 / 51KB,
    z7 702 / 160KB, z8+ adaptively capped (750 / 182KB), cluster counts sum
    to 156,057; Venice bbox at z11 gives 66 clusters for 1,384 venues, Rome
    centre at z14 gives 1,621 venue dots.
  - Live `PORT=4190 node ui/server.mjs` then `/api/national-map`: first request
    (index build) 6,702ms for 224 clusters / 50KB at zoom 6 all-Italy;
    follow-ups 23ms for 341 clusters / 83KB (zoom 8 bbox), 16ms for
    66 clusters / 15KB (zoom 11 Venice bbox), 23ms for 1,621 venues / 691KB
    (zoom 14 Rome centre).
  - `node --check` on the extracted inline map script: syntax OK.
- Frozen holdout crawl command from the previous `Next executable task`: completed
  the remaining 2,135 outcomes and resumed 669 existing outcomes, for 2,804 total.
- `node evaluate-automatic-rule.mjs --partition locked_holdout --fixture-dir benchmark/session-12-combined-final/cohort-1 --fixture-dir benchmark/session-12-combined-final/cohort-2 --db data/automatic-rule/holdout-assessments.sqlite --expected-venues 1000 --expected-candidates 2804 --output benchmark/AUTOMATIC-FIRST-PARTY-LOCKED-HOLDOUT-EVALUATION-V1.json`: executed once; the gate failed with 2 correct and 1 false conclusive publication.
- Report invariant check: 2,804 assessed candidates, 1,000 reviewed venues, 1 false
  publication, and `acceptance.passed=false`.
- `npm test`: 48 test files passed, 0 failed.
- Frozen SHA-256 check: all four code artifacts still match the freeze manifest.
  Evaluation report SHA-256:
  `ef900e97c2beeddf5c4ac6aab31bdc2d9dd4aa07363cf7b69eec71ed7f68f89e`;
  local holdout assessment database SHA-256:
  `24216a740f96f8289295ba1ee5440a74856c69237524dc4cb07bcc67b89ef291`.
- `git diff --check`: clean.

## Blockers

- No hard blocker. The OpenRouter API key has $8.93 left of its $25 limit (after
  `b005`), enough for about two more 5,000-venue batches. Each further batch needs the
  operator's approval and its own cap (default $5, never above the key's remaining limit). Only
  outcomes of the frozen reviewer certified on holdout v1 (`REVIEWER-FREEZE.json`) are
  published as verified.
