# Execution status

Updated: 2026-10-17 (Pomovi signup API live behind Pomovi's gate; search matches word starts; counts unchanged)
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

`PROCESS.md` steps 1–6, 8 and 9 are done; 7 has the cold-start check open. "Done means" checklist:

| Check | State |
|---|---|
| Operator signs in from a phone | Done 2026-09-27 |
| Same counts as the laptop map | Confirmed by the operator on the live app, 2026-09-28 |
| A manual review made online reaches the local store on sync | Tested on a local database only; confirm on the first real review's sync |
| A venue moves through the pipeline | Tested on a local copy only |
| Create its demo in Pomovi | Done 2026-09-28: Pomovi venue 15 `al-giardinetto-oderzo` |

CRM views (`PROCESS.md` step 8, decided 2026-09-28, before the Pomovi bridge): built
and verified locally (commits `cd45004`, `4f5785a`, `c542dbe`) and **deployed on
2026-09-28** (migration `0002` applied to Neon; deployment
`restaurant-finder-cweab535k`). The operator checked it signed in on the phone
(2026-09-28): counts match the map. At their request the app now opens on `/leads`
(`/` redirects there with its query string; the map moved to `/map`).

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
- Installable app (2026-09-28, operator request): `web/app/manifest.ts`, a tomato icon
  (`web/app/icon.svg`, `apple-icon.png`, `public/icons/`), iOS web-app metadata. No
  service worker: every page is live data behind sign-in. `proxy.ts` lets the manifest
  and icons through signed out, since browsers fetch them without the session cookie.
- `PRIVACY.md` covers venue contacts (business data only, notice at first contact,
  erasure, retention); like the rest of the prospecting purpose, it is not cleared until
  the operator signs the assessment.
- Measured on the real 156,057 venues: a cached table page 2–15 ms (37 ms with a text
  search), 100 rows 6–8 KB gzipped, each sort 80–320 ms once per instance, +20 MB heap.
  Headless checks on a local dev server: first rows 0.4 s on desktop and 1.75 s on a
  phone over throttled 4G (dev build), a jump to 60% down the table 0.3–1.2 s, record
  0.2–0.8 s.

Live checks (`PROCESS.md` step 7):

- CSV export: Vercel refuses buffered function responses above 4.5 MB (a whole-Italy
  export is 41.8 MB). Since 2026-09-28 the online export is streamed
  (`LeadIndex.csvChunks()`, 2,000 rows per chunk); Vercel's guide says streamed
  responses are exempt. **Confirmed live** on 2026-09-28: the operator downloaded the
  whole-Italy file (~42 MB) from `/leads`.
- Cold start: after a fix on 2026-09-27, the same steps timed from the laptop take about
  2.6 s. The live timing line (`lead index …: fetch … ms, build … ms`) needs a signed-in
  load first; not read yet.

Pomovi bridge (2026-09-28, built from this session): steps 1–4 of
`../pomovi/docs/plans/restaurant-finder-bridge.md` are **deployed** in Pomovi
(`cbb5e01`, migration `0069` applied after a verified backup), and this app is
redeployed (`restaurant-finder-khq5tcjk1`) with `POMOVI_BRIDGE_URL`
(`https://app.pomovi.com`) and `POMOVI_BRIDGE_TOKEN`, the same value as Pomovi's
`RESTAURANT_FINDER_BRIDGE_TOKEN`. Both are *sensitive* on Vercel and cannot be read
back. First round trip (operator, 2026-09-28): a shortlisted lead
(`venue:026051:oderzo:giardinetto-oderzo`) → **Create demo** → Pomovi venue 15
`al-giardinetto-oderzo`; **Continue in Pomovi** opened the wizard, which read the
branding and found menu sources by itself (checked read-only in Pomovi's database).
**Refresh from Pomovi** (then only on `/map` → Pipeline tab) read the demo back.
Pomovi's plan is archived there. Since 2026-09-28 the button is also on the venue
record's "Pomovi demo" box and in the `/leads` actions (under "More" on a phone). They add `POST`/`GET /api/bridge/venues`
(bearer `RESTAURANT_FINDER_BRIDGE_TOKEN`; unset = 404), migration `0069`
(`venues.source_ref`), a "da restaurant-finder" mark in
Pomovi's registry, a "Sito non verificato" notice for `candidate` websites, and a
wizard that starts branding and menu search by itself when opened from
`wizard_url`. This app's client (`web/lib/pomovi.ts`) needed no change: the answer
matches the contract it reads.

Before real outreach (operator): clear the "Second purpose, B2B prospecting" items in
`PRIVACY.md`, and move Vercel to Pro when the app is first used to contact a venue.

## Integration — Pomovi self-signup (live behind Pomovi's gate)

Pomovi's `signup-and-trial` step 2: bearer-only `GET /api/pomovi/search` and
`POST /api/pomovi/signups`. **Deployed 2026-10-17** (`e71cd2c`) with
`POMOVI_INBOUND_TOKEN` set (Pomovi step 10); Pomovi's signup is password-gated.
Cold first search on Hobby 10.5 s (index build), ~0.5 s warm. Search matches the
start of the name first, then the start of any later word («giardinetto» finds
«Al Giardinetto Oderzo»), never an arbitrary substring; the town stays an exact
filter. Contract:
`web/README.md` → *Pomovi self-signup catalogue and notifications*. No migration.
No production query, sync, website review, model call or deployment was initiated.

Search projects the existing `LeadIndex` (at most 10 results), including the correct
URL of pending manual approvals. Notifications are transactional/idempotent, advance
only demo stages, preserve manual sales stages, and refuse do-not-contact. No signup
contact details are copied to the CRM. The ordinary Google guards remain in place.
Production rollout and actual Hobby cold-start measurement remain pending for
Pomovi's approved step 10; local timings below are not live measurements.

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
   the agent session dies with it). No per-batch Wi-Fi watchdog: since 2026-09-28 the
   machine runs one (`interface/scripts/wifi-watchdog.sh`, user timer
   `codex-pocket-wifi-watchdog`), reconnecting after two 256 KB probes under 200 KB/s;
   its reconnects are in `interface/.codex-pocket/wifi-watchdog.log`. Watch for
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
  the internet line; reconnecting fixes it, and the machine's Wi-Fi watchdog now does
  that automatically (Wi-Fi power saving off did not help; a cable is the real fix).
- `lib/lib.test.mjs` "get does not load PDF or image bodies…" occasionally fails under
  a parallel `npm test` (shared `/tmp` cache dir); it passes alone.
- npm registry calls can hang on this host; the headless renderer uses the installed
  Chrome with no npm dependency.

## Open operator decisions

- Further CRM features after the chosen Pomovi self-signup integration (`PROCESS.md` step 10).
- Approval, scope, and cap of any further verification batch.

## Next executable task

Continue Pomovi's `signup-and-trial` Codex lane at step 3 (limits, signals and bot
check), then integrate the catalogue client in steps 4–5. The restaurant-finder
rollout and Hobby timing stay in that plan's owner-approved step 10. Do not deploy,
configure production secrets, or query production to finish the local code step.

## Last verification

2026-10-17 — Pomovi signup API:

- `cd web && npm run typecheck`: clean.
- `cd web && NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5435/postgres AUTH_SECRET=<local-test-secret> npm run build -- --webpack`:
  compiled, both new API routes dynamic. The webpack flag supports worktree-linked
  dependencies; no build/deployment setting changed.
- `node --test lib/pomovi-signups.test.mjs lib/national-leads.test.mjs`: **21/21**
  (11 new integration tests plus 10 existing catalogue tests). Fixtures and PGlite
  are isolated from the national store and Neon.
- `npm test`: 300/302; existing renderer failure plus the documented parallel
  PDF-cache race. `npm test -- --test-concurrency=1`: **301/302**, only
  `lib/headless-browser.test.mjs:16` fails. The same test fails on unchanged `main`
  (`974598a`) and alone; a direct local probe reports `cdp_timeout:Page.navigate`.
  The PDF test passes alone/serially. Renderer/reviewer code was not changed.
- Built `next start` at 3030, disposable Postgres 17 at 5435: 44 HTTP and real
  concurrent-transaction checks passed. Unset token 404, wrong/missing token 401,
  Google/development cookies cannot substitute in production, exact proxy paths,
  normal APIs remain private, no-store headers, prefix/town/reference search,
  validation, duplicate and out-of-order events, won preserved, DNC refused,
  pending manual approval uses its own URL. Five database connections deliver one
  note per event. No production manual review was recorded.
- Temporary app/database processes stopped by recorded PID; ports 3030/5435
  confirmed free; both disposable database directories and worktree dependency
  symlinks removed. The operator's checkouts and databases were not changed.
- Full snapshot copy `3a86b85efbc5`, 156,057 venues: first authenticated catalogue
  request **2162 ms**, 20 warm requests **median 6 ms / max 10 ms**. Runtime index log:
  fetch **135 ms**, build **1638 ms**. Local only; Hobby measurement still open.

## Blockers

- Real outreach: the `PRIVACY.md` prospecting items are not cleared.
- Self-signup production rollout: pending Pomovi step 10, with explicit owner approval.
- The existing local Chrome/CDP test times out on unchanged code; investigate before
  relying on a further website-review batch. Each batch still needs operator approval
  and a cap within the key's remaining limit.
