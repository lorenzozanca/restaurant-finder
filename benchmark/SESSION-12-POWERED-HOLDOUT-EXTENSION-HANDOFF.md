# Session 12 powered holdout extension — Stage D handoff

Date: 2026-09-07  
Status: **Stage D passed; no evaluator executed**  
Next owner: **designated Stage E final operator**

## Completed scope

- The two frozen selections contain exactly 500 venues each and 1,000 unique
  venue IDs in total, with zero cross-cohort overlap.
- Original cohort fingerprint:
  `09d36070bdb62e5c64eaa9eada9ca0c240b4deafcfabef091d3ff2eba6645b48`.
- Extension cohort fingerprint:
  `ad9d58f215a91ce0da8863e03bbe33cc6442a664bcd0d7c6022e83efa3b06e8e`.
- Original coverage is 500 captures and 500 adjudications across 34 partial
  capture files and 6 adjudication files.
- Extension coverage is 500 captures and 500 adjudications across 5 partial
  capture files and 5 adjudication files.
- Full projected validation passes for both cohorts. Every retained publisher
  domain is adjudicated exactly once and every evidence URL is contained in its
  corresponding bounded capture.
- The extension adjudication covers 1,590 publisher domains: 55 verified,
  1,522 rejected, and 13 uncertain.
- All original preservation hashes, extension freeze hashes, extension capture
  hashes, and extension adjudication hashes match.
- Search queries issued or reopened during adjudication: **0**.
- Completed search queries reopened during capture: **0**.
- Evaluator runs: **0**.

## Deterministic title projection

The raw first-cohort partial capture remains unchanged. Final assembly projects
every retained title to its first 200 Unicode code points. Exactly one raw title
requires this projection: first-cohort sample 496. The extension has no
overlong retained title.

The assembler refuses an existing output directory, creates two isolated
cohort directories, removes only the evaluator-exclusion naming marker in the
new copies, applies the title projection, copies adjudications without changing
the sources, and validates each complete cohort before returning.

## Pinned Stage D tooling

- `benchmark/assemble-session-12-combined-fixtures.mjs`:
  `75a6e0039a8aa0c4ad0e24250f952a30ef7fd508b6d4ef27365084004c94039b`
- `benchmark/preflight-session-12-extension-handoff.mjs`:
  `763f7cc4d866f323e2c4b922d846d8838d1be57150914cd60bd936cd8c6d70bf`
- Frozen combined evaluator:
  `909bedeaba5ba0c5f9740ce0701a335d31a3a2d3374a16392bdf3b0bc6014a22`

## Exact Stage E commands

Run these commands from the repository root, in this order. The output
directory and evaluation report must not already exist.

```bash
node benchmark/preflight-session-12-extension-handoff.mjs
node benchmark/assemble-session-12-combined-fixtures.mjs --output benchmark/session-12-combined-final
node benchmark/evaluate-session-12-combined.mjs \
  --first-directory benchmark/session-12-combined-final/cohort-1 \
  --second-directory benchmark/session-12-combined-final/cohort-2 \
  --first-selection benchmark/SESSION-12-POWERED-HOLDOUT-SELECTION.json \
  --second-selection benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-SELECTION.json \
  --first-fingerprint 09d36070bdb62e5c64eaa9eada9ca0c240b4deafcfabef091d3ff2eba6645b48 \
  --second-fingerprint ad9d58f215a91ce0da8863e03bbe33cc6442a664bcd0d7c6022e83efa3b06e8e \
  --output benchmark/SESSION-12-POWERED-HOLDOUT-COMBINED-EVALUATION.json
```

The third command is the single authorized evaluator execution. It was not run
during Stages A–D. The final operator must preserve and report its first output
whether it passes, fails, or is inconclusive; no search, re-adjudication,
selective exclusion, replacement, or evaluator rerun is permitted.
