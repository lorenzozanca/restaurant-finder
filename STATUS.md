# Execution status

Updated: 2026-09-25 (reviewer certified; production pipeline built; batch b001 ready)
Branch: `main`

## Current milestone

Process the 86,852 known candidates with the certified reviewer (`PROCESS.md` step 4),
in operator-approved batches of about 5,000 venues with a $5 cap each. The reviewer
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
- National counts unchanged: 112 verified, 0 candidate assessments.

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
- Map states: 86,852 source candidates, 112 verified websites, 6 rejected candidate
  domains, and 69,205 venues without a source candidate.
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

1. Check the link (`iw dev wlp58s0 station dump`: rx bitrate well above VHT-MCS 0);
   if degraded, the operator runs `sudo nmcli connection up "Italia Uno"`.
2. Run batch `b001` with the frozen settings and a $5 cap:
   `node assess-labelled-corpus.mjs --partition development --fixture-dir data/national-review/batches/b001 --venue-db data/istat/2026-01-01/derived/italy-import.sqlite --db data/national-review/review.sqlite --cache-dir data/national-review/cache --concurrency 12 --llm-review --run-id national-b001 --budget-usd 5 --verifier-model xiaomi/mimo-v2.6-pro`
3. `node publish-national-review.mjs`, restart `node ui/server.mjs`, and report the map's
   verified, rejected, and assessed counts. Then ask the operator before the next batch
   (`prepare-national-batch.mjs --size 5000`, run ID `national-b002`).

## Acceptance gate for the automatic verifier (unchanged from v1)

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.
- Also reported: stage-1 false rejections and cost per candidate.

## Last verification

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

- No LLM verdict is "verified". Publication still requires certification on a new
  locked holdout (`PROCESS.md` step 3).
