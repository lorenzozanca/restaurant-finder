# Next scaling session handoff

Updated: 2026-09-01
State: Sessions 8 and 9 are complete. Session 10 ran and ended in a quality
NO-GO: the cold pilot completed, while its warm replay is durably paused at the
shared request ceiling. The 25-request reserve is intact; 156,057 national
candidates remain queued and untouched.

The bounded offline correction is complete. It blocks all 14 observed
official-site false positives, requires first-party publication evidence, and
fixes the observed ordering-platform role mismatch. No live requests were
used, and the live decision remains NO-GO pending independent resource
adjudication and a fresh authorized pilot. See
`benchmark/SESSION-10-OFFLINE-CORRECTION-REPORT.md`.

Read this file first, then `ITALY-WEB-ENRICHMENT-PLAN.md` and
`benchmark/PHASE-8-LIVE-ACCEPTANCE-REPORT.md`.

## Verified starting point

- The live Oderzo acceptance manifest passed 75/75 gates across two isolated
  cold runs and one warm run. The three publication sets were identical.
- The final deterministic suite passed 31/31 test files before this handoff. Run it
  again at the start of the next session.
- Session 8 is complete. Evidence schema v2 and the durable queue provide
  leases, crash recovery, bounded retries, dead letters, cancellation,
  idempotent result application, persistent budgets/circuits, run manifests,
  worker tests, operator commands, and a UI-compatible JSON export. See
  `benchmark/SESSION-8-REPORT.md`.
- The recovery plan is archived at
  `benchmark/archive/SEARCH-RECALL-RECOVERY-PLAN-COMPLETED-2026-08-27.md`.
- The offline Veneto import contains 13,073 canonical venue candidates and the
  same number of queued jobs. All jobs are still `queued`; the attempts table is
  empty. No crawl, search, worker, or other scaling process is running. See
  `benchmark/SESSION-9-VENETO-OFFLINE-REPORT.md`.
- The pinned ISTAT archive now also reproduces one national layer with 7,895
  current municipalities across all 20 regions. National-mode importing,
  region inventories, and ISTAT-code venue-ID namespaces pass deterministic
  tests. A no-store smoke run of the Veneto rectangle against all Italian
  boundaries assigned 19,074 source records to 965 municipalities without
  creating jobs. See `benchmark/SESSION-9-NATIONAL-BOUNDARIES-REPORT.md`.
- Session 9 is complete. The pinned national Overture extract contains
  3,100,760 records (3,676,409,954 bytes). Exact clipping and admission
  produced 156,740 source records and 156,057 canonical candidates in 7,398
  municipalities; all 156,057 jobs remain queued with zero attempts. See
  `benchmark/SESSION-9-NATIONAL-OFFLINE-REPORT.md`.
- The deterministic Session 10 calibration sample contains 40 reviewed source rows:
  two per region, balanced 20/20 by known/missing source website, with small,
  medium, large, tourism-focus, general-market, language-variant, venue-type,
  and chain coverage. Manual review approved 36 and retained four as uncertain.
  The isolated database contains only the 36 approved rows, all queued with two
  maximum attempts and zero attempts made. See
  `benchmark/SESSION-10-MANUAL-REVIEW-CHECKPOINT.md`.
- The redone live cold pilot completed 36/36 jobs but official-website precision
  was only 10/24 (41.7%, Wilson 95% CI 24.5–61.2%). Fourteen accepted links
  were directories, reviews, editorial pages, or otherwise not the labelled
  official site. The warm replay completed 6/36 jobs and then paused at the
  combined 72-request ceiling. See `benchmark/SESSION-10-LIVE-PILOT-REPORT.md`.

## Local Veneto Overture input

This workstation already has a regional Overture Places extract at:

`data/overture/2026-07-22.0/veneto-places-bbox.geojsonseq`

The directory is intentionally Git-ignored because the extract is 342,142,912
bytes. It contains 287,081 newline-delimited place features and has SHA-256:

`fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230`

Its local manifest is:

`data/overture/2026-07-22.0/veneto-places-bbox.manifest.json`

The extract is pinned to Overture release `2026-07-22.0`, schema `v1.18.0`,
and was downloaded with `overturemaps 1.0.2`. It covers the rectangular bbox
`10.6231032,44.7922924,13.1020861,46.6806148`, derived from Veneto's OSM
administrative relation `43648`. It therefore includes neighbouring records
and remains the immutable raw input.

The exact offline import is complete using ISTAT non-generalized geometry dated
2026-01-01 plus the official Castegnero/Nanto merger effective 2026-02-21. Its
boundary manifest is `data/istat/2026-01-01/veneto-boundaries.manifest.json`;
large source/derived geometry and the SQLite store remain Git-ignored. The
tracked aggregate result is
`benchmark/VENETO-OFFLINE-INVENTORY-2026-08-27.json`, fingerprint
`7a1f9c0827bb26a00331edda2959175471788d13bae22b2197b4203682156637`.

The initial offline inventory found 30,152 supported food-primary records in
the rectangle, including 19,085 at confidence >= 0.9. These are candidates,
not reviewed venues. Exact clipping and all admission gates produced 13,113
source records and 13,073 canonical candidates. Importing used no Brave calls.

## Brave budget

The operator reported 97 Brave requests available. The Session 10 cold and
partial warm runs consumed the configured 72-request ceiling. The remaining 25
requests are an operational reserve and must not be spent without a new explicit
allowance and a fresh run authorization.

The Brave API key is deliberately not stored in this repository. The key that
was shared in chat should be rotated; configure its replacement only through
the `BRAVE_SEARCH_API_KEY` environment variable when live testing resumes.

## Pinned national input

Use Overture Places release `2026-07-22.0`, schema `v1.18.0`, in GeoJSONSeq
format for the national candidate import. This preserves the provider schema,
admission gates, provenance, and importer contract already validated on Veneto.
The intended extraction bbox is the exact envelope of the pinned national
ISTAT layer: `6.626621418,35.492852585,18.520381593,47.091783741`.

The extract is stored at
`data/overture/2026-07-22.0/italy-places-bbox.geojsonseq`. It contains 3,100,760
records, is 3,676,409,954 bytes, and has SHA-256
`39d433dcfba6d0705b1d9092eac44f1766d213566b23f02e41c53c0204cb8c3c`.
Its tracked manifest records the v1.0.2 client checksum, explicit release
selector, state file, bounding box, schema, and acquisition command.

## Next bounded objective

Quota exhaustion is now implemented as a resumable pause. Brave quota
exhaustion, whether detected by the configured local request budget or a
provider response such as HTTP 429, now:

- stop new Brave-dependent claims and stop the worker cleanly rather than churn
  through queued jobs;
- preserve the current job and all unstarted jobs for later resumption without
  consuming retry attempts or sending them to `dead_letter`;
- persist an explicit provider-quota reason and, when known, the reset or
  `retry_after` time;
- avoid recording a successful no-result, `no_resources_found`, rejection, or
  manual-review outcome solely because Brave was unavailable; and
- resume idempotently from the same durable queue after Brave becomes
  available, either automatically after the recorded reset or through
  `node queue-ops.mjs resume-quota --db PATH --provider brave_web_api`.

Deterministic tests cover local-budget exhaustion and Brave HTTP 429, including
clean worker stop, durable restart, unchanged attempt count, and successful
manual or automatic resume. Implementation and tests spent zero live requests.

The operator authorized and supplied credentials for the bounded live pilot on
2026-09-01. The review was redone and the cold run completed, but the quality
decision is NO-GO. The required offline correction now hard-rejects the 14
observed directory/editorial official-site candidates, versions them as
regression fixtures, requires first-party evidence, and reconciles the observed
ordering-platform role mismatch. Before any new live run, independently
adjudicate the remaining novel resource outputs and obtain a new explicit
provider allowance. Do not resume the warm checkpoint merely to consume the
reserve. See `benchmark/SESSION-10-LIVE-PILOT-REPORT.md` and
`benchmark/SESSION-10-OFFLINE-CORRECTION-REPORT.md`.

Do not start either the 13,073-job Veneto queue or the 156,057-job national
queue wholesale. No national publication is authorized by the offline import.

## Start-of-session checks

```bash
git status --short
node --test
jq empty data/overture/2026-07-22.0/veneto-places-bbox.manifest.json
jq empty data/overture/2026-07-22.0/italy-places-bbox.manifest.json
sha256sum data/overture/2026-07-22.0/veneto-places-bbox.geojsonseq
sha256sum data/overture/2026-07-22.0/italy-places-bbox.geojsonseq
sha256sum data/istat/2026-01-01/source/Limiti01012026.zip
sha256sum data/istat/2026-01-01/derived/veneto-municipalities.geojson
sha256sum data/istat/2026-01-01/derived/italy-municipalities.geojson
node queue-ops.mjs status --db data/istat/2026-01-01/derived/veneto-import.sqlite
node queue-ops.mjs status --db data/istat/2026-01-01/derived/italy-import.sqlite
```

Expected checksum:
`fed3fc6d1de7057cbc224eb3f7d9cccc0183aad5df6fef2fbf04db03e2ef3230`.

Expected national Overture checksum:
`39d433dcfba6d0705b1d9092eac44f1766d213566b23f02e41c53c0204cb8c3c`.

Expected ISTAT archive and derived checksums:

- `a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f`
- `355285130a22498786a1613ae76b93e1ccdbf12edd87be477f8271e33258e109`
- `b6514449818f13c3252492c1b85f35701523b269fd9d4e192ea7d06f568f0783`

Expected queue status: Veneto 13,073 `queued`; national 156,057 `queued`;
both with zero attempts and zero terminal jobs.

## Required end-of-session repository cleanup

The operator wants the next session to finish with all intended repository work
integrated into `main` and pushed to `origin/main`. Before committing, inspect
every tracked and staged path for credentials, personal data, provider-response
caches, and local databases. Keep `.env`, `data/session-10/`, web caches, and
other local runtime artifacts untracked; never print or commit the Brave key.

At handoff, run the full tests and `git diff --check`, review the staged diff,
commit only the intended source, fixtures, manifests, and reports, then push
`main`. Fetch and verify that `main` and `origin/main` have no ahead/behind
commits and that the worktree contains no intended uncommitted changes. Delete
any temporary local feature branch only after its tip is proven merged into
`main`. The repository is already on `main` as of 2026-09-01, so there is no
current feature branch to delete; apply this cleanup if the fresh session
creates one.
