# Session 2 benchmark report

Date: 2026-08-26

This comparison uses the version 1 offline labels and the same deterministic
evaluator for both snapshots. The “after” snapshot is the frozen output of the
admission cases locked by `sources/web-search.test.mjs`; it is not presented as
a new live-provider scan. Live search is intentionally excluded so the result
is reproducible.

| Metric | Before | After Session 2 |
| --- | ---: | ---: |
| Venue admission precision | 40.9% | **100.0%** |
| Venue admission recall | 75.0% | **75.0%** |
| Venue false positives | 13 | **0** |
| Venue false negatives | 3 | 3 |
| Official website precision | 38.1% | **88.9%** |
| Resource-role precision | 56.3% | **100.0%** |
| Unresolved duplicate groups | 1 | 1 |

For Oderzo specifically, venue precision changes from 33.3% to 100%. All
eight known false positives are absent after admission, while Barhacca and Pub
Gatto Nero remain present with their labelled links. The three known coverage
losses—Al Giardinetto, Ristorante Locanda Dussin, and Gli Ingordi—remain false
negatives. Restoring aliases and resolving the Ca’Lozzio duplicate belong to
later identity sessions and were not hidden by this change.

The initial 98% venue-precision publication gate passes on this small fixture.
That is a regression gate, not evidence that national precision is already
known: the synthetic strata must be supplemented with manually reviewed real
samples before a pilot publication decision.

Commands:

```bash
node benchmark/evaluate.mjs
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-2.json
```
