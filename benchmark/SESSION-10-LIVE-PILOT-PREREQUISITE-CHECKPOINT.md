# Session 10 checkpoint — live pilot runner and prerequisite audit

Date: 2026-09-01
Decision: **runner pass; live pilot authorized but blocked before networking**
Live Brave requests: **0**

## Outcome

The operator authorized continuation after the Brave allowance replenished. The
new `run-pilot.mjs` entry point records that bounded authorization while keeping
the national queue and publication unauthorized. It enforces the existing
72-request combined ceiling and 25-request reserve, uses a budget period that
does not reset at midnight, meters physical provider attempts, shares one Brave
request-per-second scheduler across two workers, limits provider and domain
concurrency to one, and atomically applies enrichment results through the
durable queue. Local-budget exhaustion or Brave HTTP 429 remains a durable
quota pause.

The runner fails closed before opening the database or making a request unless
the API key and both pinned input fingerprints match. Focused tests cover the
missing-key gate, reviewed-selection fingerprint gate, request metering,
evidence persistence, and successful run completion.

## Blocking integrity findings

The preserved isolated database is untouched at 36 queued jobs and zero
attempts. Its main-file SHA-256 still matches the checkpointed value
`ab805e70b7c8a2dce0dc0815a9c12ad011c1e056b56f380eb1cbe627d0cbc9b0`.

The tracked selection file no longer contains the completed review labels. Its
current SHA-256 is
`8c5ba9e49f2605dd66452f7a9f3b850849b7c6f50c86d5035709b5fd56816cb4`,
while the manual-review checkpoint pins the reviewed file as
`889d419414e961462c29ad135cb4bcb174a7e3da03331e28131b39d104837850`.
All 40 current review objects are blank. The reviewed file must be restored or
the 40 rows must be reviewed again and repinned before the pilot is auditable.

`BRAVE_SEARCH_API_KEY` is also absent from the current process environment. A
rotated key must be supplied through that environment variable; it must not be
stored in the repository or pasted into a tracked file.

## Verification

- `node --test`: 33/33 test files pass.
- `git diff --check`: pass.
- Live runner preflight: stops on the reviewed-selection SHA-256 mismatch.
- Pilot queue: 36 `queued`, zero attempts, zero terminal jobs, zero quota pauses.

## Next bounded task

Restore the reviewed selection with SHA-256 `889d…` or repeat and pin the
40-row review, expose the rotated Brave key to the process, then run only:

```bash
node run-pilot.mjs \
  --db data/session-10/session-10-pilot.sqlite \
  --manifest benchmark/SESSION-10-LIVE-PILOT-RUN.json
```

Do not begin Session 11 until the cold and warm Session 10 calibration runs,
review metrics, capacity estimate, and go/no-go decision are complete.
