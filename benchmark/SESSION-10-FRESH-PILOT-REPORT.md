# Session 10 fresh live pilot report

Date: 2026-09-01
Decision: **NO-GO for Sessions 11 and 12**
Publication authorized: **no**
National or regional queue authorized: **no**

## Outcome

A deterministic fresh 40-row selection excluded every venue ID from the prior
pilot. Molise moved from Bagnoli del Trigno to Campobasso because the original
municipality had no second known-website candidate after exclusion. Independent
manual review approved 36 venues and quarantined four uncertain rows. The
reviewed selection has SHA-256
`b6cb9777eeee6b3bef531cfd1c5663cf22b2d4f225c493e76d0dd2bfec882efd`.

The isolated cold run `session-10-fresh-cold-v2` completed 36/36 jobs with 72
Brave attempts. The warm replay `session-10-fresh-warm-v1` completed 36/36 with
25 additional attempts. Both runs were provider-healthy: no HTTP 429, quota
pause, dead letter, or open circuit. Combined use was 97/120 requests, leaving
23 inside the pilot ceiling and approximately 803 of the reported monthly 900.

An earlier sandboxed diagnostic consumed eight local budget reservations but
received no HTTP response; all were transport errors followed by an open local
circuit. It produced no facts, used a separate database/cache, and is excluded
from provider-use and quality metrics.

## Quality gates

The unchanged strict evaluator compares venue ID and registrable website domain.
Intervals are two-sided 95% Wilson intervals.

| Measure | Result | 95% interval | Gate | Decision |
| --- | ---: | ---: | ---: | --- |
| Venue admission precision | 36/36 (100.0%) | 90.4–100.0% | >=98% | Not demonstrated by this sample |
| Official-website precision | 5/14 (35.7%) | 16.3–61.2% | >=95% | Fail |
| Official-website recall | 5/21 (23.8%) | 10.6–45.1% | measured | Poor |
| Strict pre-adjudication resource precision | 1/7 (14.3%) | 2.6–51.3% | >=95% | Fail/incomplete labels |
| Independently adjudicated resource precision | 3/7 (42.9%) | 15.8–75.0% | >=95% | Fail |

The nine strict website errors include GialloZafferano, Grubbio, OpenDi,
res-menu.net, MyCIA, and Mapstr directory/menu-mirror pages. The Molo Factory
legacy domain also differs from the current manually pinned Molo Cortina domain.
These results reproduce the systemic third-party publication failure on a fully
fresh sample despite the first offline correction.

All seven published resource outputs were independently reviewed. The three
Riserva Rooftop outputs (two menu PDFs and the cocktail page) are correct. Ranch
Roberta's table-reservation page and La Bastiglia's external reservation page
were incorrectly labelled `order`; the Molo `sample-menu` page could not be
established as current publishable evidence; and the Grubbio menu is a
third-party mirror. The independent result is therefore 3/7.

## Operational metrics

- Cold: 36/36 succeeded; 72 provider attempts.
- Warm: 36/36 succeeded; 25 provider attempts.
- Combined provider budget: 97/120 used; 23 unused.
- Search observations: 91 misses and 41 hits; 47 persisted search-cache files.
- Final facts: 14 accepted websites; 7 accepted, 26 rejected, and 1 review resource.
- Database integrity: `ok`; size approximately 1.4 MiB.
- Final database SHA-256:
  `f9f5061e01e77a41a38aa27670d981fe57ba1fd42691c462e3ce72d495fe6dc7`.
- National and Veneto queues remained queued with zero attempts.

## Offline follow-up

No further live run is authorized. The observed directory hosts are now hard
classified as non-official, and booking links are classified separately from
food-ordering surfaces. These offline changes require a future independent
pilot under a new explicit allowance before rollout can be reconsidered.
