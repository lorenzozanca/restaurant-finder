# Next scaling session handoff

Updated: 2026-08-27
State: Phase 8 live acceptance is GO; no scaling run has started.

Read this file first, then `ITALY-WEB-ENRICHMENT-PLAN.md` and
`benchmark/PHASE-8-LIVE-ACCEPTANCE-REPORT.md`.

## Verified starting point

- The live Oderzo acceptance manifest passed 75/75 gates across two isolated
  cold runs and one warm run. The three publication sets were identical.
- The final deterministic suite passed 26/26 tests before this handoff. Run it
  again at the start of the next session.
- The recovery plan is archived at
  `benchmark/archive/SEARCH-RECALL-RECOVERY-PLAN-COMPLETED-2026-08-27.md`.
- No national import, regional crawl, enrichment queue, or other scaling
  process is running.

## Local Veneto Overture input

This workstation already has a regional Overture Places extract at:

`data/overture/2026-07-22.0/veneto-places-bbox.geojsonseq`

The directory is intentionally Git-ignored because the extract is 342,142,912
bytes. It contains 287,081 newline-delimited place features and has SHA-256:

`fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230`

Its local manifest is:

`data/overture/2026-07-22.0/veneto-places-bbox.manifest.json`

The extract is pinned to Overture release `2026-07-22.0`, schema `v1.18.0`,
and was downloaded with `overturemaps 1.0.2`. It covers the rectangular bbox
`10.6231032,44.7922924,13.1020861,46.6806148`, derived from Veneto's OSM
administrative relation `43648`. It therefore includes neighbouring records
and is not publication-ready. Clip it to the exact Veneto polygon and assign
records to ISTAT municipalities before treating it as regional data.

The initial offline inventory found 30,152 supported food-primary records in
the rectangle, including 19,085 at confidence >= 0.9. These are candidates,
not reviewed venues. Downloading and inventorying the file used no Brave calls.

## Brave budget

The operator reported 907 of 1,000 free-plan Brave requests consumed on
2026-08-27, leaving 93 until the provider's next monthly reset. The exact reset
date was not recorded. Do not spend those remaining requests on scaling or a
multi-town pilot unless the operator explicitly authorizes it. Prefer offline
import, fixtures, and deterministic tests until the allowance resets.

The Brave API key is deliberately not stored in this repository. The key that
was shared in chat should be rotated; configure its replacement only through
the `BRAVE_SEARCH_API_KEY` environment variable when live testing resumes.

## Next bounded objective

Continue with Session 8 of `ITALY-WEB-ENRICHMENT-PLAN.md`: finish the durable,
resumable enrichment queue and its operational controls. SQLite evidence
persistence, provider scheduling, retries, budgets, and circuit breakers exist,
but there is not yet a complete leased job queue with recovery, cancellation,
dead-letter handling, and idempotent worker tests.

Do not start a Veneto-wide crawl. Once Session 8 passes offline, use the local
Veneto extract as preparatory material for Session 9's importer and municipality
assignment. The first live regional work belongs in Session 10's stratified
pilot after the Brave reset and another explicit budget check.

## Start-of-session checks

```bash
git status --short
node --test
jq empty data/overture/2026-07-22.0/veneto-places-bbox.manifest.json
sha256sum data/overture/2026-07-22.0/veneto-places-bbox.geojsonseq
```

Expected checksum:
`fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230`.
