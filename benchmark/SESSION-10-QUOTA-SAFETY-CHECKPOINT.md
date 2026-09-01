# Session 10 checkpoint — quota-safe pilot prerequisite

Date: 2026-08-28
Decision: **pass; pilot selection may proceed, live pilot not started**
Live Brave requests: **0**

## Outcome

Local request-budget exhaustion and a terminal Brave HTTP 429 now stop the
worker as a durable quota pause rather than an ordinary failed job. The leased
job returns to `queued`, its attempt count is restored, its running attempt row
is removed, and no result or evidence is applied. The pause records its scope,
provider, reason, rate headers, and reset/retry time when available.

Claims honor global, provider, and domain quota pauses. A future reset time
allows automatic resume; an operator can resume a confirmed replenished
provider with:

```bash
node queue-ops.mjs resume-quota \
  --db data/istat/2026-01-01/derived/italy-import.sqlite \
  --provider brave_web_api
```

Both pause paths have deterministic restart-and-resume coverage. The evidence
store schema is version 3 and migrates older stores by adding `quota_pauses`.

## Allowance assessment

The operator reports 97 Brave requests currently available. This can support a
small hard-capped calibration run, helped by the 86,852 / 156,057 national
candidates (55.65%) that already carry a source website. It cannot alone prove
all Session 10 quality gates or authorize regional scaling. As a useful scale
reference, with zero observed errors a two-sided 95% Wilson lower bound reaches
approximately 95% only around 73 independent reviewed positives, and 98% only
around 189.

The pilot manifest must therefore set a Brave budget below 97, retain an
operational reserve, cap searches per venue, and describe the run as a
calibration slice unless its reviewed denominators genuinely support the
required confidence intervals.

## Verification

- `node --test`: 30/30 test files pass.
- `git diff --check`: pass.
- Local-budget test: clean stop, attempt count 0, durable block after restart,
  explicit resume, then success.
- HTTP 429 test: persisted `retry-after`, clean stop, durable block before
  reset, automatic resume after reset, then success.
- Existing national and Veneto queues were not opened for writing or run.

## Next bounded task

Create the deterministic stratified pilot selection and manual-review labels.
Record municipality-size and tourism strata, all regions, venue types, known
website coverage, cold/warm scenarios, and exact request/concurrency/domain
limits before making a live request.
