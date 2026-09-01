# Session 10 checkpoint — deterministic pilot selection

Date: 2026-08-28
Decision: **selection pass; superseded by completed manual review; live pilot not authorized**
Live Brave requests: **0**

## Outcome

`select-pilot.mjs` reads the national evidence store in read-only mode and
reproducibly selected 40 untouched queued candidates: two in each of Italy's
20 regions, with one known Overture website and one missing website in every
region. The tracked output is `SESSION-10-PILOT-SELECTION.json`, SHA-256
`1cf923b70a141485cf6a7f0d43fc75e78d09e1696f59ac5c4b948f7c8ebf1f1c`.

The sample covers 12 large-, 18 medium-, and 10 small-inventory candidates;
26 tourism-focus and 14 general-market candidates; four municipalities with
language-variant sampling intent; all seven admitted venue types; and one
explicit chain branch. Municipality size means venue count in the pinned
inventory, not population. Tourism and language labels are test-design strata,
not official statistics, and must be confirmed during review.

The selection initially contained blank review objects. Those fields were
completed on 2026-08-28; see `SESSION-10-MANUAL-REVIEW-CHECKPOINT.md` for the
reviewed checksum, outcomes, and isolated pilot details.

## Pinned safety limits

- Reported Brave allowance: 97 requests.
- Combined cold plus warm Brave ceiling: 72 requests.
- Retained operational reserve: 25 requests.
- Resolver maximum per venue: three searches and three crawls.
- Worker concurrency: two; Brave provider concurrency: one; per-domain
  concurrency: one; provider pacing: one request per second.
- Maximum job attempts: two.
- Quota exhaustion remains a durable pause, not a result.

The manifest explicitly sets live pilot, national queue, and publication
authorization to false. Cold and warm scenarios share the 72-request ceiling.

## Reproduction

```bash
node select-pilot.mjs \
  --db data/istat/2026-01-01/derived/italy-import.sqlite \
  --inventory benchmark/ITALY-OFFLINE-INVENTORY-2026-08-28.json \
  --output benchmark/SESSION-10-PILOT-SELECTION.json
```

Selection takes about four seconds on this workstation and makes no network
requests. Unit coverage checks determinism, known/missing website pairing,
blank labels, fixed budget reserve, non-authorization, and fail-closed behavior
for a missing stratum cell.

Final verification: `node --test` passes 31/31 test files, `git diff --check`
passes, and a second selector run reproduces the tracked SHA-256 exactly.

## Queue integrity

After selection, the national store still contains exactly 156,057 `queued`
jobs and zero enrichment attempts. All 40 selected rows have attempt count zero.
No request budget, run manifest, evidence fact, result, or queue state changed.

## Superseding checkpoint

Manual review and isolated pilot construction are complete. Do not run workers
against the national store or the isolated pilot without explicit live-pilot
authorization.
