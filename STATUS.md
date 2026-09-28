# Execution status

Updated: 2026-09-28 (documents reordered: the online CRM is the primary track; no
product change since 2026-09-27)
Branch: `main`

## Current counts

National map (after batch `b006`, 2026-09-26; no batch or online manual decision since):

| | Venues |
|---|---:|
| All venues | 156,057 |
| Source website candidates | 86,852 |
| Verified websites | 5,982 |
| Rejected candidates | 3,294 |
| Checked candidates (assessments) | 25,818 |
| No source candidate | 69,205 |

Lead statuses (sum 156,057): 5,982 verified, 3,294 rejected, 2,350 directory, 6,870
undecided, 7,417 unreachable, 60,955 not checked, 69,189 no website.

## Track 1: online lead CRM (primary)

Live at <https://restaurants.trelua.com> (also restaurant-finder-iota.vercel.app):
Vercel project `restaurant-finder` (Hobby, root directory `web`), Neon
`restaurant-finder` (free plan, eu-central-1), Google sign-in for `AUTH_OWNER_EMAILS`.
First sync 2026-09-27: snapshot `3a86b85efbc5`, 86,895 venue details, 0 manual reviews.
Setup, sync, and deploy commands: `web/README.md`.

`PROCESS.md` steps 1–6 are done. "Done means" checklist:

| Check | State |
|---|---|
| Operator signs in from a phone | Done 2026-09-27 |
| Same counts as the laptop map | Matched on a local copy (5,982 of 156,057); not compared on the live app |
| A manual review made online reaches the local store on sync | Tested on a local database only; confirm on the first real review's sync |
| A venue moves through the pipeline | Tested on a local copy only |
| Create its demo in Pomovi | Blocked: Pomovi's endpoints are not built |

Decided 2026-09-28: CRM views (tables of all leads, venue record page, contacts,
activities) come before the Pomovi bridge (`PROCESS.md` step 8). `PRIVACY.md` now
covers venue contacts (business data only, notice at first contact, erasure,
retention); like the rest of the prospecting purpose, it is not cleared until the
operator signs the assessment.

Open live checks (`PROCESS.md` step 7):

- Cold start: after a fix on 2026-09-27, the same steps timed from the laptop take about
  2.6 s. The live timing line (`lead index …: fetch … ms, build … ms`) has not been read.
- Whole-selection CSV export (tens of MB for all of Italy): not tried against Vercel's
  function response-size limit.

Pomovi side: the bridge plan is committed and pushed in Pomovi
(`docs/plans/restaurant-finder-bridge.md`, latest `0bc0a81`). No endpoint is built
(`/api/bridge/venues` does not exist there yet).

Before real outreach (operator): clear the "Second purpose, B2B prospecting" items in
`PRIVACY.md`, and move Vercel to Pro when the app is first used to contact a venue.

## Track 2: website verification (on operator request)

The frozen reviewer (MiMo v2.6 Pro, prompt `llm-ownership-dev-3`,
`benchmark/llm-review-holdout-v1/REVIEWER-FREEZE.json`) passed the adjudicated
holdout-v1 gate on 2026-09-24: 105 correct, 0 false, Wilson lower bound 96.5%.

Production batches (`PROCESS.md` step 4), each published with
`publish-national-review.mjs`:

| Batch | Scope | Venues | Reviewed | Accepted | Rejected | Cost |
|---|---|---:|---:|---:|---:|---:|
| `b001` | national | 5,000 | 2,495 | 1,094 | 626 | $2.74 |
| `b002` | national | 5,000 | 2,516 | 1,064 | 657 | $2.86 |
| `b003` | national | 5,000 | 2,477 | 1,097 | 604 | $2.92 |
| `b004` | national | 5,000 | 2,566 | 1,098 | 672 | $2.98 |
| `b005` | Veneto | 5,796 | 3,160 | 1,527 | 729 | $3.43 |
| `b006` | Veneto (bare-host URLs) | 22 | 14 | 3 | 3 | $0.02 |
| Total | | 25,818 | 13,228 | 5,883 | 3,291 | $14.95 |

Veneto is fully checked. 61,029 eligible venues remain. A national batch of 5,000 costs
about $3 and takes about an hour. The OpenRouter key had $8.91 left of its $25 limit on
2026-09-26.

### Batch runbook (only after the operator approves a batch and its scope)

1. Check the link: `iw dev wlp58s0 station dump` shows an rx bitrate well above
   VHT-MCS 0, and ping to 1.1.1.1 is under 50 ms. If not, run
   `nmcli connection up "Italia Uno"` (no sudo needed).
2. `node prepare-national-batch.mjs --size 5000 [--region CODE]` (ISTAT region code,
   e.g. `05` = Veneto) writes the next `bNNN`. Then run, detached, logging to
   `data/national-review/bNNN.log`, with a cap below the key's remaining limit:
   `node assess-labelled-corpus.mjs --partition development --fixture-dir data/national-review/batches/bNNN --venue-db data/istat/2026-01-01/derived/italy-import.sqlite --db data/national-review/review.sqlite --cache-dir data/national-review/cache --concurrency 12 --llm-review --run-id national-bNNN --budget-usd 5 --verifier-model xiaomi/mimo-v2.6-pro`
   Launch with `setsid nohup bash -c '…; echo "exit $?" >> …log' &` (a process tied to
   the agent session dies with it), plus a detached Wi-Fi watchdog: every 30 s ping
   1.1.1.1 five times; if the average exceeds 500 ms or all are lost, run the `nmcli`
   command, at most once per 2 minutes; stop when the log has its `exit` line. Watch for
   a stalled log too: a worker error can hang the process instead of exiting. If the
   link dropped (many EAI_AGAIN, connect timeouts, or provider errors), rerun once with
   `--retry-state retryable` (same run ID and cap).
3. `node publish-national-review.mjs` (rebuilds the map snapshot), then read
   `/api/national/meta` (`stats`, `statuses`) on a fresh `node ui/server.mjs` and report
   verified, rejected, and checked counts. Then run the sync command in `web/README.md`.
   Update the tables above.

## Operating notes

- Never record a manual review on the live app as a test: the next sync applies it to
  the national store.
- Slow crawls usually mean the laptop's Wi-Fi association degraded (rx VHT-MCS 0), not
  the internet line; reconnecting fixes it.
- `lib/lib.test.mjs` "get does not load PDF or image bodies…" occasionally fails under
  a parallel `npm test` (shared `/tmp` cache dir); it passes alone.
- npm registry calls can hang on this host; the headless renderer uses the installed
  Chrome with no npm dependency.

## Open operator decisions

- Which CRM features come after the Pomovi bridge (`PROCESS.md` step 10).
- Approval, scope, and cap of any further verification batch.

## Next executable task

Build the CRM views (`PROCESS.md` step 8, "CRM views"), in this order, committing each
verified part:

1. `LeadIndex.table()` with sorted permutations, CRM overlay columns and filters, and
   tests (counts equal to `summary()`, paging without loss or repeats, budgets).
2. Migration `0002` (`contacts`, `pipeline_events.contact_id`, `saved_views`), the
   contacts and activities API, the extended overlay, and the backup of the new tables.
3. The pages: app bar, Leads table, venue record, Contacts (with "Due for deletion"),
   Activities; a link from the map's venue card to the record.
4. Phone and desktop checks of the new pages, then deploy.

Then the live checks (step 7): the cold-start line from `npx vercel logs --since 1h
--expand`, and the whole-Italy CSV export size against Vercel's function response
limit. Then the Pomovi bridge (step 9), built in the Pomovi repository following
`../pomovi/docs/plans/restaurant-finder-bridge.md`.

## Last verification

- 2026-09-28, documents only (`AGENTS.md`, `PLAN.md`, `PROCESS.md`, `STATUS.md`):
  `git diff --check` clean; every file path named in the four documents exists; the
  `PROCESS.md` references in code (`step 2`, `step 3`, `step 3.3`, steps 3.5–3.6,
  `step 4`, "Online lead CRM") still resolve to the same sections.
- Last code change (2026-09-27, faster cold start of the online map):
  `node --test lib/national-leads.test.mjs` 6 passed; `npm test` 280 passed; `web`
  `npx tsc --noEmit` clean, `npm run build` compiled; `npx vercel deploy --prod` ready.
  Live, signed out: `/` → 307 `/signin`, `/api/national/meta` 401.

## Blockers

- Create demo: Pomovi's bridge endpoints are not built.
- Real outreach: the `PRIVACY.md` prospecting items are not cleared.
- Verification batches: none technical; each needs operator approval and a cap within
  the key's remaining limit.
