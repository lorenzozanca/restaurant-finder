# Execution status

Updated: 2026-09-28 (CRM views built and verified locally, not yet deployed; national
counts unchanged)
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

CRM views (`PROCESS.md` step 8, decided 2026-09-28, before the Pomovi bridge): built
and verified locally on 2026-09-28 (commits `cd45004`, `4f5785a`, `c542dbe`), **not
deployed**: the live app still has only the map, and Neon lacks migration `0002`.

- `/leads`: all 156,057 venues; the map's filters plus next-action due and
  has-contacts; 11 sortable columns (`LeadIndex.table()`, cached permutations); built-in
  and saved views; a column chooser; rows load 100 at a time and only rows in view are
  rendered (cards on phones). "Show on map" and the map's new **Table** button carry the
  same filters.
- `/venues/[id]`: identity, website and verification (why, and the manual review
  form), sales (stage, next action), contacts, log a touch with a contact, timeline,
  Pomovi demo. The map's venue card links to it.
- `/contacts` (with "Due for deletion", the retention list) and `/activities`.
- Data: migration `0002` (`contacts`, `pipeline_events.contact_id`, `saved_views`),
  `lib/crm-records.mjs`, backups include the new tables.
- `PRIVACY.md` covers venue contacts (business data only, notice at first contact,
  erasure, retention); like the rest of the prospecting purpose, it is not cleared until
  the operator signs the assessment.
- Measured on the real 156,057 venues: a cached table page 2–15 ms (37 ms with a text
  search), 100 rows 6–8 KB gzipped, each sort 80–320 ms once per instance, +20 MB heap.
  Headless checks on a local dev server: first rows 0.4 s on desktop and 1.75 s on a
  phone over throttled 4G (dev build), a jump to 60% down the table 0.3–1.2 s, record
  0.2–0.8 s.

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

Deploy the CRM views (needs the operator's go-ahead: it changes the live app and
applies migration `0002` to Neon):

1. From the repository root: `node --no-network-family-autoselection --dns-result-order=ipv4first --env-file=.env.local sync-online.mjs`
   (applies `0002`, then the usual sync), then `npx vercel deploy --prod`.
2. Signed out: `/leads`, `/contacts`, `/activities`, `/venues/…` redirect to `/signin`;
   `/api/crm/leads` answers 401. Ask the operator to open `/leads` on the phone and
   confirm the counts match the map.
3. Then the live checks (step 7): the cold-start line from `npx vercel logs --since 1h
   --expand`, and the whole-Italy CSV export size against Vercel's function response
   limit.

After that: the Pomovi bridge (step 9), built in the Pomovi repository following
`../pomovi/docs/plans/restaurant-finder-bridge.md`.

## Last verification

- CRM views (2026-09-28):
  - `npm test`: 290 passed, 0 failed (new: `lib/crm-records.test.mjs`, 7 tests against
    PGlite; table and CRM-overlay tests in `lib/national-leads.test.mjs`).
  - `cd web && npx tsc --noEmit`: clean; `npm run build`: compiled, routes `/leads`,
    `/contacts`, `/activities`, `/venues/[id]`.
  - Throwaway PGlite database synced from the real store
    (`sync-online.mjs --no-reviews --no-backup`: migrations `0001`, `0002`; 156,057
    venues; 9.9 s), `next dev` with `AUTH_DEV_EMAIL`: contact create and validation,
    stage and next action, touch with a contact, due and contacts filters, activities,
    saved views, 404 for an unknown venue, all through the API.
  - `node ui/crm-views-check.mjs --base http://127.0.0.1:3057 --venue venue:028001:abano-terme:altabaco [--desktop]`:
    14 of 14 checks passed on phone and desktop (timings above; no page errors).
  - `next start` (production mode, signed out): the four new pages 307 to `/signin`; every
    new API route 401, also with a forged session cookie.
  - The test database was deleted; nothing touched Neon, the national store, or
    `data/online-backups/`.
- Last code change (2026-09-27, faster cold start of the online map):
  `node --test lib/national-leads.test.mjs` 6 passed; `npm test` 280 passed; `web`
  `npx tsc --noEmit` clean, `npm run build` compiled; `npx vercel deploy --prod` ready.
  Live, signed out: `/` → 307 `/signin`, `/api/national/meta` 401.

## Blockers

- Create demo: Pomovi's bridge endpoints are not built.
- Real outreach: the `PRIVACY.md` prospecting items are not cleared.
- Verification batches: none technical; each needs operator approval and a cap within
  the key's remaining limit.
