# Execution status

Updated: 2026-09-09
Branch: `main`

## Current milestone

Validate a strict automatic first-party rule against the existing labelled evidence,
then process the 86,852 known source candidates in resumable zero-search batches.

## Completed and visible

- National inventory: 156,057 venues in 7,398 municipalities.
- National map: `http://localhost:4188/map.html` via `node ui/server.mjs`.
- Map states: 86,852 source candidates, 112 verified websites, 6 rejected candidate
  domains, and 69,205 venues without a source candidate.
- The map supports municipality/venue search, municipality autocomplete, status
  filters, national clustering, and individual venue details.
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
- The locked holdout crawl is safely checkpointed at 669/2,804 persisted candidate
  outcomes across all 1,000 venues: 41 strongly correlated, 36 ambiguous, 16
  contradicted, 227 retryable, and 349 unsupported publisher. The locked labels have
  not been evaluated; the one authorized evaluation remains unused.

## Verified facts about the old method

- The 14-venue Oderzo acceptance did not generalize.
- National pilots achieved only 41.7% and 35.7% official-website precision.
- The later 1,000-venue result tested a human ownership gate: 96 human-verified
  publications, zero false publications, and 904 abstentions. It did not validate an
  automatic ownership classifier.
- The 86,852 source candidates already exist and need no Brave search.
- A 20-venue zero-search crawl sample fetched 18 candidates but published zero because
  automatic crawl evidence cannot currently create an ownership attestation.

## Next executable task

Resume the frozen zero-search locked-holdout crawl from its 669/2,804 persisted
candidate outcomes with:

`node assess-labelled-corpus.mjs --partition locked_holdout --fixture-dir benchmark/session-12-combined-final/cohort-1 --fixture-dir benchmark/session-12-combined-final/cohort-2 --db data/automatic-rule/holdout-assessments.sqlite --cache-dir output/.cache/automatic-rule-holdout --venue-db data/istat/2026-01-01/derived/italy-import.sqlite --concurrency 16 --timeout 20000`

Do not run the evaluator until all 2,804 outcomes are present. Then execute the frozen
evaluator exactly once against the locked labels and apply the acceptance gate before
authorizing any 86,852-candidate production run.

## Acceptance gate for the automatic rule

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.

## Last verification

- `npm test`: 48 test files passed, 0 failed.
- Holdout preflight with a no-network crawl stub: 39 fixture documents, 1,000 unique
  venues, and 2,804 candidate outcomes persisted successfully in a temporary database.
- Frozen SHA-256 check: all four code artifacts plus the development report and local
  development assessment database matched the freeze manifest.
- `git diff --check`: clean.
- Real national-map API: 156,057 venues; 86,852 source candidates; 112 verified; 6
  rejected; 69,205 without candidates; 0 assessments in every assessment bucket. An
  Oderzo (`TV`) query returned 54 venues and included the per-candidate assessment
  field. National index cold-load time was 10.5 seconds.

## Blockers

No product or data blocker. Resuming the live crawl may require network permission;
it requires no paid-search budget and Brave remains disabled.
