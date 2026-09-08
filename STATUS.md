# Execution status

Updated: 2026-09-08
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

Crawl the already-labelled development corpus with search disabled, persist its
candidate assessments, derive the strict automatic first-party rule only on that
development evidence, freeze the rule, and evaluate it once against the existing
locked national holdout. Do not start the 86,852-candidate production run before that
accuracy gate passes.

## Acceptance gate for the automatic rule

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.

## Last verification

- `npm test`: 46 test files passed, 0 failed.
- `git diff --check`: clean.
- Real national-map API: 156,057 venues; 86,852 source candidates; 112 verified; 6
  rejected; 69,205 without candidates; 0 assessments in every assessment bucket. An
  Oderzo (`TV`) query returned 54 venues and included the per-candidate assessment
  field. National index cold-load time was 10.5 seconds.

## Blockers

The next task's zero-search live crawl requires network permission. It requires no
paid-search budget; Brave remains disabled.
