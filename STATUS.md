# Execution status

Updated: 2026-09-09
Branch: `main`

## Current milestone

Resolve the failed automatic-publication gate before any 86,852-candidate production
run. The frozen v1 rule is rejected and its locked holdout cannot be reused.

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
- The later 1,000-venue result tested a human ownership gate: 96 human-verified
  publications, zero false publications, and 904 abstentions. It did not validate an
  automatic ownership classifier.
- The 86,852 source candidates already exist and need no Brave search.
- A 20-venue zero-search crawl sample fetched 18 candidates but published zero because
  automatic crawl evidence cannot currently create an ownership attestation.

## Next executable task

Obtain the operator's product decision: either authorize a development-only v2 rule
effort with a genuinely new independent locked holdout, or replace the automatic
publication route. Do not tune against or reevaluate the now-exposed v1 holdout, and
do not start the 86,852-candidate production run under v1.

## Acceptance gate for the automatic rule

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.

## Last verification

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

The required automatic-publication gate failed and the v1 holdout is now exposed.
Continuing requires a product decision between a new independently tested v2 effort
and a different delivery route. No paid-search budget was used; Brave remains
disabled.
