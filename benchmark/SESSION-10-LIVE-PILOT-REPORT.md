# Session 10 live pilot report

Date: 2026-09-01
Decision: **NO-GO for Sessions 11 and 12**
Publication authorized: **no**
National or regional queue authorized: **no**

## Outcome

The 40-row manual review was redone from current web evidence. It approved 36
venues and quarantined four uncertain candidates. The reviewed selection has
SHA-256 `9546da07c0a84e0f1dfee17a0c0faeae114176e62f672d3dc0aa4457b6dd573d`.

The isolated cold run `session-10-live-pilot-v2` completed all 36 jobs in
88.5 seconds. Brave remained healthy: 71 physical provider attempts, no HTTP
429, no provider quota pause, and no terminal jobs. The run persisted 57 cold
search observations, 24 accepted website facts, and 12 accepted resource
facts.

The warm run `session-10-live-pilot-warm-v1` reused the same database, cache,
and combined request budget. It completed 6 jobs, including four search-cache
hits, then stopped durably with 30 jobs queued when the local budget reached
72/72. The reported 97-request allowance therefore retains the promised
25-request reserve. The pause is correctly recorded as
`local_request_budget_exhausted`, not as a provider 429. The warm run remains a
resumable checkpoint and is not represented as complete.

## Quality gates

The deterministic evaluator compares accepted facts with the redone manual
labels using venue ID, registrable website domain, and exact resource role.
Intervals are two-sided 95% Wilson intervals.

| Measure | Result | 95% interval | Gate | Decision |
| --- | ---: | ---: | ---: | --- |
| Venue admission precision | 36/36 (100.0%) | 90.4–100.0% | >=98% | Not demonstrated by this sample |
| Official-website precision | 10/24 (41.7%) | 24.5–61.2% | >=95% | Fail |
| Official-website recall | 10/17 (58.8%) | 36.0–78.4% | measured, not a publication gate | Poor |
| Strict resource-role precision | 2/12 (16.7%) | 4.7–44.8% | >=95% | Fail/incomplete adjudication |
| Strict resource-role recall | 2/6 (33.3%) | 9.7–70.0% | measured | Poor |

The strict resource measure counts only a matching labelled venue, site domain,
and role. Several newly found first-party resources look plausible, so they
need an independent post-run adjudication before this number can be considered
a final resource estimate. That uncertainty cannot turn the pilot into a pass:
the official-website result independently fails by a wide margin.

Fourteen of 24 published website facts were wrong under the benchmark. The
systemic pattern is acceptance of directories, review sites, editorial pages,
and unrelated pages as official venue websites. Examples include Trivago for
Bar Il Malcantone, Wanderme for Pizzeria Il Grottino, ProntoAtutto for The
Clifton, HappyCow for Gelateria Liparoti, and Il Tacco di Bacco for Bagia'.
Three of those wrong links displaced known official sites; four additional
official sites were missed entirely.

## Operational metrics

- Cold run: 36/36 succeeded; 71 provider attempts; 57 persisted cache misses.
- Warm checkpoint: 6/36 succeeded, 30 queued; four persisted cache hits and one
  additional provider request before the local ceiling stopped the run.
- Combined request budget: 72/72 used; 25-request reserve unspent.
- Search cache: 50 files, approximately 268 KiB.
- Live pilot database: approximately 2.1 MiB; `PRAGMA integrity_check = ok`.
- Current database SHA-256:
  `b2d1e84507704238febb4415f8e4d04ac8c3f12037d909133eb8dbd25a772aef`.
- National and Veneto queues were not run or opened for pilot writes.

## Reproduction

```bash
npm run evaluate:pilot
node --test
```

The authoritative live state is
`data/session-10/session-10-pilot-live.sqlite`; the active configuration is
`SESSION-10-LIVE-PILOT-RUN.json`. The separate
`data/session-10/session-10-pilot-redo.sqlite` records an earlier sandboxed DNS
diagnostic and is not included in the live metrics.

## Required next work

Do not resume the warm run merely to improve throughput figures, and do not
spend the reserve. First hard-reject directory/editorial/review hosts unless a
separate policy explicitly classifies them as secondary sources; require
first-party officialness evidence before accepting a website; add these 14
false positives as regression fixtures; reconcile the resource-role taxonomy
with the benchmark; then rerun a fresh, independently reviewed pilot under a
new explicit provider allowance. Sessions 11 and 12 remain blocked.

## Offline follow-up

The directory/editorial hard rejects, all 14 regression fixtures, independent
first-party publication gate, and the observed ordering-platform role fix were
completed offline on 2026-09-01. See
`SESSION-10-OFFLINE-CORRECTION-REPORT.md`. This used no live requests and does
not change the NO-GO decision; independent resource adjudication and a fresh
authorized pilot are still required.
