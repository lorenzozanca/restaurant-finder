# Session 10 checkpoint — manual baseline review and isolated pilot

> Superseded on 2026-09-01. The review was redone from current web evidence;
> the authoritative selection hash is
> `9546da07c0a84e0f1dfee17a0c0faeae114176e62f672d3dc0aa4457b6dd573d`.
> The live result and no-go decision are recorded in
> `SESSION-10-LIVE-PILOT-REPORT.md`. The remainder of this file preserves the
> earlier checkpoint for audit history.

Date: 2026-08-28
Decision: **manual review complete; isolated pilot ready; live pilot not authorized**
Live Brave requests: **0**

## Outcome

All 40 candidates in `SESSION-10-PILOT-SELECTION.json` now have complete manual
review labels, evidence URLs, reviewer identity, timestamp, and notes. The
review accepted 36 candidates for the isolated pilot and retained four as
`uncertain`; uncertain rows were not copied into the pilot database.

Website review produced 17 accepted official sites, five rejected source
website claims, 15 `no_official_site` labels, and three uncertain website
labels. Notable issues include third-party URLs represented as websites,
renamed venues, and several street-number or current-address discrepancies.
No duplicate relationship was found within the 40-row selection.

Reviewed selection SHA-256:
`889d419414e961462c29ad135cb4bcb174a7e3da03331e28131b39d104837850`.

## Isolated database

`prepare-pilot.mjs` validates every review fail-closed and creates a fresh
durable database from only candidates labeled `valid`, assigned to the correct
municipality, and not marked as duplicates. It refuses to overwrite an
existing target and refuses source jobs that are no longer untouched.

The local, Git-ignored database is:

`data/session-10/session-10-pilot.sqlite`

It contains 36 venues, 36 source records, and 36 queued jobs. Every job has
`max_attempts = 2`; there are zero attempts, results, dead letters, quota
pauses, or terminal jobs. `PRAGMA integrity_check` returns `ok`. After a clean
WAL checkpoint its SHA-256 is
`ab805e70b7c8a2dce0dc0815a9c12ad011c1e056b56f380eb1cbe627d0cbc9b0`.

The national store remains unchanged at 156,057 queued jobs and zero attempts.

## Reproduction

```bash
node prepare-pilot.mjs \
  --source data/istat/2026-01-01/derived/italy-import.sqlite \
  --manifest benchmark/SESSION-10-PILOT-SELECTION.json \
  --output data/session-10/session-10-pilot.sqlite \
  --max-attempts 2
```

Final verification passes 32/32 test files and `git diff --check`.

## Next bounded task

Do not start the worker until the operator explicitly authorizes the live
pilot and supplies a rotated Brave key through `BRAVE_SEARCH_API_KEY`. Before
authorization, pin the pilot run manifest and request budgets against the
remaining provider allowance; preserve the 25-request contingency reserve and
the combined cold/warm ceiling of 72 requests.
