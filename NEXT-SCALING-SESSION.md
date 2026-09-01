# Next scaling session handoff

Updated: 2026-09-01
State: Sessions 8 and 9 are complete. Both Session 10 pilots ended in quality
NO-GO decisions. The fresh isolated cold and warm runs completed 36/36 jobs
using 97 of their combined 120-request ceiling, but official-website precision
was only 5/14 (35.7%) and independently adjudicated resource precision was only
3/7 (42.9%). No further live run is authorized. The 156,057 national candidates
remain queued and untouched.

The offline architectural correction requested after those failures is now
complete. Official-site publication requires a trusted venue-scoped ownership
attestation; page content cannot create that attestation. Offline replay removed
all 23 false publications across both pilots while retaining all 15 true
publications, and provider failure plus cold-to-warm gating now fail closed.
No Brave requests were used. See
`benchmark/SESSION-10-ARCHITECTURAL-CORRECTION-REPORT.md`.

## Operator directive after the second failed pilot

The operator is justifiably dissatisfied that two pilots consumed 169 actual
Brave requests (72 in the first pilot and 97 in the fresh pilot) while
reproducing the same systemic directory-publication failure. **Do not run
another live pilot, warm replay, canary, or individual Brave query.** Do not ask
for another provider allowance. The next session is offline-only unless the
operator later gives a new, explicit authorization after reviewing a completed
architectural correction.

The prior correction was overfitted. It blocked the 14 hosts already observed
and passed a fixture containing those same hosts, but it did not establish a
general proof that a publisher is controlled by the venue. On the fresh sample,
previously unseen directories and menu mirrors passed through the same gap:
GialloZafferano, Grubbio, OpenDi, res-menu.net, MyCIA, and Mapstr. Contact,
address, municipality, restaurant schema, canonical links, and menu-like
resources proved that pages were *about* a venue; they did not prove that the
publisher was the venue. The code still treated a branded-looking domain as
first-party evidence by itself, which is not a valid ownership proof.

There was also an avoidable process error: the 25-request warm replay ran before
the 72-request cold output was adjudicated. The cold run had already reproduced
the failure, so the warm replay should have been cancelled. Future procedures
must place an adjudication gate immediately after cold execution; warm execution
must never be automatic.

The earlier bounded offline correction is complete but superseded by the
fail-closed architectural correction. It blocks all 14 observed
official-site false positives, requires first-party publication evidence, and
fixes the observed ordering-platform role mismatch. No live requests were
used. It is historical context, not the next objective. See
`benchmark/SESSION-10-OFFLINE-CORRECTION-REPORT.md`.

Read this file first, then `ITALY-WEB-ENRICHMENT-PLAN.md` and
`benchmark/PHASE-8-LIVE-ACCEPTANCE-REPORT.md`.

## Verified starting point

- The live Oderzo acceptance manifest passed 75/75 gates across two isolated
  cold runs and one warm run. The three publication sets were identical.
- The final deterministic suite passed 35/35 test files after the architectural
  correction. Start the next session with the focused ownership/store tests
  listed below; run the full suite once at final verification.
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

The earlier Session 10 allowance was 97 Brave requests. Its cold and partial
warm runs consumed the configured 72-request ceiling and left the old
25-request reserve untouched.

On 2026-09-01, the operator reported approximately 900 Brave requests available
for the month and authorized the fresh validation plan. The completed cold and
warm runs used 97 of their combined **120 Brave API request** ceiling, leaving
23 unspent inside that ceiling and approximately 803 of the reported monthly
allowance. That authorization is exhausted by completion of the scoped plan; it
does not authorize another pilot, resuming the old warm checkpoint, or running
the Veneto or national queues.

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

## Completed safeguards

Quota and provider unavailability now pause the durable queue, preserve the
current job without consuming an attempt, and prevent successful empty results.
Completed historical pilot allowances are non-runnable. Warm execution requires
an explicit passing cold-output adjudication instead of following cold execution
automatically.

The official-site architectural correction is also complete. Publication now
requires a trusted, venue-scoped, timestamped publisher-ownership attestation.
Name, phone, address, municipality, schema, canonical metadata, menus, source
URLs, and branded-looking domains establish relevance only; crawled page content
cannot create ownership. Offline replay rejected all 23 false publications and
retained all 15 true publications across the two pilots. See
`benchmark/SESSION-10-ARCHITECTURAL-CORRECTION-REPORT.md`.

## Next session objective — durable ownership review workflow, offline only

The remaining problem is operational: pilot selection JSON currently supplies
trusted ownership attestations at runtime. Make those attestations durable and
reviewable without weakening the fail-closed invariant.

1. Add a versioned SQLite publisher-attestation model scoped to one canonical
   venue and one publisher domain. Store status, method, attested website,
   evidence URLs, reviewer, review time, lifecycle state, and audit events.
2. Validate every write. Reject missing evidence, unsupported methods, invalid
   domains/timestamps, venue mismatches, and attempts to infer an attestation
   from crawled or search-result content.
3. Add idempotent offline import of accepted ownership reviews from the two
   pinned Session 10 selection files. Preserve their original reviewer, time,
   notes, evidence URLs, and selection fingerprint.
4. Change enrichment to load trusted attestations from the evidence store. The
   production path must no longer depend on injecting review JSON into the
   in-memory restaurant object, while direct callers may still supply an
   explicitly trusted attestation dependency for deterministic tests.
5. Add bounded operator commands or a small local review interface to list
   unattested candidates, inspect evidence, approve/reject ownership, revoke an
   attestation, and view its audit history. No command may publish a website as
   a side effect of review.
6. Gate every export on an active matching attestation. Add tests proving that
   revoked, expired, malformed, cross-venue, wrong-domain, and absent
   attestations cannot publish, including generated unseen directory hosts.
7. Backfill and replay only the two isolated Session 10 pilot databases on
   copies. The result must still reject 23/23 adjudicated false publications and
   retain 15/15 true publications. Report removals and retention separately;
   these remain offline replay counts, not live quality estimates.
8. Run focused tests while developing, then one full deterministic suite and
   `git diff --check` at the end. Write a concise offline workflow report and
   stop.

Use **zero Brave calls**. Do not select another pilot, request an allowance, run
a canary, resume an old warm run, or execute Veneto/national enrichment. A future
live step may be considered only after the operator reviews the completed
durable workflow; it must begin cold with a new explicit hard cap and must stop
for adjudication before any warm run.

Do not start either the 13,073-job Veneto queue or the 156,057-job national
queue wholesale. No national publication is authorized by the offline import.

## Start-of-session checks

```bash
git status --short
node --test lib/publisher-ownership.test.mjs lib/evidence-store.test.mjs run-pilot.test.mjs benchmark/publisher-replay.test.mjs
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
