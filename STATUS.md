# Execution status

Updated: 2026-09-24 (LLM reviewer core)
Branch: `main`

## Current milestone

Certify the LLM ownership reviewer (`PROCESS.md` steps 2–3) before any
86,852-candidate production run. The frozen v1 rule is rejected, and its locked
holdout can no longer qualify anything; it may serve as development data.

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
  - `dev-3` (MiMo only; prompt dev-3; stopped after 20 reviews to diagnose the network):
    1 publication, correct, 0 false; 0 false rejections (the McDonald's fix held);
    3 labelled-official candidates left unresolved. Cost $0.0226 ($0.0011 per
    reviewed candidate).
  - Total LLM spend to date: $0.073 of the operator's $2 first-try limit.
  - These runs are not evidence of accuracy yet. Almost the whole corpus is still
    unreviewed because of the network (below): 250 of 351 crawlable candidates are
    still `retryable`.
- Network diagnosis (corrected): the internet line's throughput from this laptop is
  capped at ~20 KB/s (~160 kbit/s). Idle RTT to 1.1.1.1 is 9.6 ms with 0% loss. One
  `curl` of a large file got 20,751 B/s, and RTT rose to 728 ms average (1.7 s max)
  during it. Any sustained crawl therefore fills the line: with `dev-3` running,
  latency reached seconds with up to 100% loss; with it stopped, 17 ms and 0% loss.
  Headless Chrome is not required for this (it also happened with `--no-headless`).
  The pattern (low idle latency, hard throughput ceiling) suggests a data-allowance
  or per-device throttle, not Wi-Fi quality (−39 dBm link, router RTT 2–30 ms).
  An earlier SIGSTOP test wrongly exonerated the crawler, because stopped processes
  keep their connections open.

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

Finish development run `dev-3` on the 200-venue corpus, once internet RTT to 1.1.1.1
is healthy (under 300 ms):

```bash
node assess-labelled-corpus.mjs --partition development --fixture-dir benchmark/session-11-web \
  --db data/llm-review/development-run-1.sqlite --cache-dir output/.cache \
  --venue-db data/istat/2026-01-01/derived/italy-import.sqlite --concurrency 4 --timeout 45000 \
  --retry-state retryable --llm-review --run-id dev-3 --budget-usd 1.90 \
  --verifier-model xiaomi/mimo-v2.6-pro
node evaluate-llm-review.mjs --partition development --fixture-dir benchmark/session-11-web \
  --db data/llm-review/development-run-1.sqlite --run-id dev-3 --output data/llm-review/dev-3-evaluation.json
```

Then record in this file: false publications, false rejections, verified sites left
unresolved, cost per reviewed candidate, and candidates per minute. Keep the total
first-try spend under $2. If the result has zero false publications, extend
development to the spent v1 holdout (`benchmark/session-12-combined-final`, 1,000
venues) under a new capped run before designing the new locked holdout.

## Acceptance gate for the automatic verifier (unchanged from v1)

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.
- Also reported: stage-1 false rejections and cost per candidate.

## Last verification

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

- Internet throughput on this machine is capped at ~20 KB/s. At that rate, the
  development crawl takes hours and the 86,852-candidate crawl would take weeks, and
  every crawl saturates the operator's connection. `dev-3` is stopped after 20 reviews (resumable with the
  command above). It needs either a restored line or a better
  connection (another network or a small cloud machine).
- No LLM verdict is "verified". Publication still requires certification on a new
  locked holdout (`PROCESS.md` step 3).
