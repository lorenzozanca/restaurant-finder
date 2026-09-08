# Execution status

Updated: 2026-09-08
Branch: `main`

## Current milestone

Decouple automatic crawl corroboration from publisher-ownership approval, validate a
strict automatic first-party rule against the existing labelled evidence, and then
process the 86,852 known source candidates in resumable zero-search batches.

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

Implement and persist **persistent candidate assessments** so a crawl can durably record
its result independently of publication ownership. The implementation must:

1. Store, per venue and candidate URL, the crawl outcome and identity, geography, and
   officialness scores.
2. Distinguish at least `strongly_correlated`, `ambiguous`, `contradicted`,
   `retryable`, and `unsupported_publisher` without creating an ownership attestation.
3. Preserve the existing rule that only ownership-verified websites are published.
4. Expose assessment counts and each candidate's assessment state through the map/API.
5. Add deterministic schema/store/scoring/map tests and migration coverage.

After this task is committed, the following task is to crawl the already-labelled
development corpus, derive the strict automatic rule there, freeze it, and evaluate it
once against the existing locked national holdout. Do not start the 86,852-candidate
production run before that accuracy gate passes.

## Acceptance gate for the automatic rule

- At least 73 correct automatic verifications on the locked evaluation.
- Zero false automatic verifications.
- Two-sided 95% Wilson precision lower bound at or above 95%.
- Timeouts and inaccessible pages abstain or retry; they never become rejections.

## Last verification

- `npm test`: 46 test files passed, 0 failed.
- `git diff --check`: clean.
- Real national-map API: 156,057 venues; 86,852 source candidates; 112 verified; 6
  rejected; 69,205 without candidates. An Oderzo (`TV`) query returned 54 venues.
- National index cold-load time on this machine: approximately 10 seconds; subsequent
  viewport queries use the in-memory index.

## Blockers

None for the next executable task. Live crawling and any paid search require the
network/budget permissions described in `PROCESS.md`; the next task is local code and
tests.
