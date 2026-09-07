# Zero-cost Phase 0 — crawl-only baseline start checkpoint

Date: 2026-09-07
Status: **started; offline baseline measured; no live crawl run**
Brave requests used: **0**
Publication authorized: **no**
National/regional queues mutated: **no**

## Entry gates

- Session 12 pooled validation passed and is committed:
  `benchmark/SESSION-12-POWERED-HOLDOUT-COMBINED-EVALUATION.json` —
  1,000 venues, 96 conclusive publications, 96 true, 0 false,
  Wilson 95% lower bound 0.9615, 73-publication minimum met.
- Starting point verified read-only before any change:
  - Italy queue: 156,057 `queued`, zero attempts, zero terminal jobs.
  - Veneto queue: 13,073 `queued`, zero attempts, zero terminal jobs.
  - Both SQLite stores contain **0 publisher attestations**.
- Full deterministic suite baseline before changes: 210/210 pass.

## Bounded scope for this start

Offline-only. No Brave request, no live HTTP crawl, no queue claim,
no production-database write. Production databases were opened only in
`mode=ro` or via a `/tmp` copy. The wholesale 86k crawl is explicitly
**not** started here; it requires a separate operator go-ahead for live
HTTP even though it costs $0 in search spend.

## Code change: fail-closed crawl-only guarantee

Gap found: `findMenuSources` with `resolverBudget.searches:0` still spent
one search request through the domain-restricted resource `site:` fallback
(the pre-existing Dussin test pins that default for searches>=1).

Fix in `find-menu.mjs`: when `resolverBudget.searches` is 0, the resource
site search now defaults to off. Callers may still opt back in with an
explicit `resourceBudget.siteSearch:true`. Pilot configs use 3 searches per
venue and are unaffected.

Tests in `find-menu.test.mjs` (+2):

- `crawl-only budget spends zero search requests including the resource
  site search` — known website, `searches:0`, default resource budget:
  zero search calls, website still accepted from crawl, both
  `search_requests` and `resource_site_search_requests` are 0.
- `crawl-only budget still crawls a known website without any identity
  search` — `searches:0` plus explicit `siteSearch:false`: menu link
  extracted from crawl only, zero search calls.

## Offline baseline (zero network, zero search, zero mutation)

Source: pinned inventory `benchmark/ITALY-OFFLINE-INVENTORY-2026-08-28.json`
plus read-only queue counts; export measured on a `/tmp` copy of
`italy-import.sqlite` via `queue-ops.mjs export`.

- Canonical venues: **156,057** in 7,398 municipalities.
- With known source website (crawl-ready): **86,852 (55.65%)**.
- Without source website (free-discovery backlog): **69,205 (44.35%)**.
- Active publisher attestations: **0** → publishable verified-website
  coverage today: **0/156,057 (0%)**, per the binding rule that export
  suppresses websites without an active attestation.
- Export of the `/tmp` copy: 156,057 restaurants, **0 with resources**,
  0 website facts — the honest shippable list shape (names + IDs, no
  unverified links).
- Backlog with no verified website: **156,057** =
  86,852 crawl+attest track + 69,205 discovery track.
- By type (canonical): restaurant 74,492; bar 29,519; cafe 22,153;
  pizzeria 21,890; pub 4,307; fast food 1,940; ice cream 1,756.
- Largest no-website regional backlogs: Lombardia 8,224; Lazio 6,538;
  Campania 6,612; Puglia 5,392; Emilia-Romagna 5,231; Sicilia 5,149
  (full per-region table is one `python3` over the inventory JSON away;
  top rows recorded here, no new artifact generated).
- Veneto subset: 13,073 canonical, 7,573 with website (57.93%),
  5,500 without; same 0% attested coverage.

## Verification

- `node --test`: **212/212 pass** (210 baseline + 2 new).
- `git diff --check`: clean.
- `git status --short`: only `find-menu.mjs`, `find-menu.test.mjs`
  modified; production databases, manifests, and queues untouched.
- Search spend in this start: 0 Brave, 0 `site:` fallback by
  construction (new regression tests fail closed on any search call).

## Next bounded step (requires operator go-ahead for live HTTP)

1. Small crawl-only sample on an isolated DB copy (suggested n=20 venues
   with known websites, stratified by region/type): run
   `findMenuSources` with `{ searches: 0, crawls: 3 }` +
   `siteSearch:false`, record crawl success, resource yield, and
   attestation lift (expected ~0 without new automatic
   `verified_reciprocal_link` / `official_registry` detectors or human
   review — the point is to measure, not to publish).
2. Then decide the first automatic-attestation detector to build and
   evaluate on unseen venues before any national crawl.
3. Wholesale queue execution stays unauthorized until that sample plus
   the attestation path are reviewed.
