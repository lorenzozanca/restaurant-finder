# Zero-cost national enrichment plan

> **2026-09-08 update:** Use this document for its discovery-track design, but
> follow
> [`benchmark/VERIFIED-VENUES-SCALING-STRATEGY.md`](benchmark/VERIFIED-VENUES-SCALING-STRATEGY.md)
> for current execution order. The registry licensing review found no lawful
> zero-cost bulk registry path, and small manual batches are not the national
> scaling mechanism. The next authorized task is a read-only backlog census.

Status: proposed — 2026-09-07
Context: national Brave search estimated at ~$2k; budget target is $0.
Supersedes nothing; constrains how Sessions 11–12 (`ITALY-WEB-ENRICHMENT-PLAN.md`)
may proceed. `NEXT-SCALING-SESSION.md` offline-only directive stays in force:
no live Brave run without a new explicit operator authorization.

## Core principle

Separate the certain from the backlog:

1. **First, publish everything verifiable for free** (crawl-only over known
   source websites). This meets the product goal directly: a national list plus
   an honest verified-website percentage.
2. **Then, work the backlog** (venues with no verified website) with free
   discovery tracks, most-certain first. Paid search is removed from the plan,
   not postponed.

## Why this works: search proposes, crawl + attestation disposes

A web-search result — Brave or otherwise — is never a verified fact in this
system. It is a **candidate**: a likely official site. Certainty is produced
only downstream by:

- crawling the candidate (`lib/lib.mjs#get`, bandwidth-only cost),
- scoring identity/geography/officialness (`find-menu.mjs#scoreOfficialWebsite`),
- and passing the venue-scoped publisher-ownership gate
  (`lib/publisher-ownership.mjs`), which requires a trusted attestation
  (human review, registry, verified claim, reciprocal link) — page content
  alone cannot create it.

The pilots proved the gap: 35–42% website precision on search-selected sites,
and the durable gate now abstains on anything unattested. So Brave spend buys
*hypotheses*, while the free crawl + attestation path is what *confirms* them.
Cutting Brave loses hypotheses, not verifications. The plan below replaces the
hypothesis supply with free sources.

## Cost anatomy (why ~$2k, why $0 is reachable)

- Backbone is already free: pinned Overture extract + ISTAT boundaries yield
  156,057 canonical venues in 7,398 municipalities (`benchmark/ITALY-OFFLINE-INVENTORY-2026-08-28.json`).
- 86,852 venues (~55.6%) already carry a source website → enrichable by
  crawl alone at $0 marginal cost.
- The ~69k venues without a source website are the entire search bill: at
  1–3 official-site searches plus up to 1 resource `site:` search per venue,
  150–300k requests × $5/1k ≈ $750–2,000. Brave's ~$5/mo free credit (~1k
  req/mo) cannot cover this on any usable timescale.

## Phase 0 — Crawl-only national baseline ($0)

Goal: ship the product goal with zero search.

- Run enrichment with resolver budget `searches: 0` over all venues carrying a
  known source website (Overture/OSM).
- Crawl → validate → ownership-gate → export via the existing
  `queue-ops.mjs export` path.
- Publish: full 156k venue list + verified-website % + explicit backlog count
  (venues with no verified website).
- Exit: baseline coverage measured; backlog sized by region/type; no search
  request spent.

### Attestation note (binding constraint)

Under the current durable policy, crawl-verified alone does not publish: export
suppresses websites without an active publisher attestation. So Phase 0's
"certain" set means crawled **plus attested**. The free paths to attestation at
scale are the automatic methods already in the model (`official_registry`
crosswalk, `verified_reciprocal_link` found by crawl); everything else flows
through the human review queue and the owner-claim loop (Phase 3). Measure
Phase 0 success as attested coverage, not merely crawled coverage.

## Phase 1 — Free discovery for the backlog, most-certain first ($0)

All tracks feed candidates into the *unchanged* crawl-verify-attest path. A
wrong candidate costs nothing but abstention. Measure each track on the frozen
Session 11 unseen methodology before trusting it.

1. **Deterministic URL guessing.** Slug × {`.it`, `.com`, `.eu`} ×
   comune-suffix probes, verified by crawl. Small code, zero queries.
2. **Chain-domain reuse.** Resolve chain homepages once; map branches by
   postcode/phone instead of searching per venue.
3. **OSM Italy planet fusion.** Local Geofabrik extract processing for
   `website`/`contact:website` tags Overture lacks, plus venues Overture
   missed. No API use.
4. **Registry crosswalk (licensing check first).** INI-PEC / Registro Imprese
   open data: PEC emails frequently reveal the venue's own domain
   (`info@nome.it` → `nome.it`). Record the `DATA-LICENSING.md` review before use.
5. **Certificate Transparency + Common Crawl joins.** Enumerate `.it` certs
   via crt.sh and query the free Common Crawl index for venue phones/exact
   names; both yield candidate domains at batch-compute cost, zero per-query fee.
6. **Keyless direct APIs (complement only).** Marginalia public JSON API +
   Wikipedia/Wikidata behind the existing provider interface. Thin coverage,
   no infra.

Exit per track: measured lift in verified coverage on unseen venues with no
precision regression; failures stay in review, never published.

## Phase 2 — Self-hosted search, only for the residual ($0 marginal)

If a backlog remains where general web search is still the only hypothesis
source, implement one `createSearxngProvider` behind the existing
`search(request)` interface (`sources/search/default-providers.mjs`) fanning
out to free engines. Benchmark against the same frozen fixtures — do not
assume parity with Brave. Caveats: scraping-based engines are ToS-gray, DDG is
unusable from datacenter IPs, public SearXNG instances block JSON, and this
adds hosting/anti-bot ops. This phase is optional and only starts if Phase 1
leaves a gap worth the ops cost.

## Phase 3 — Owner-claim loop (ongoing, $0)

Publish the list with "claim your website" (reciprocal link or DNS TXT), served
by the existing `queue-ops.mjs ownership-*` workflow. Claims arrive
pre-attested — the exact evidence the gate demands. Slowest growth, highest
precision per record. Runs in parallel with all phases.

## Gates that apply to every phase

- Offline-only until the operator explicitly authorizes otherwise; no Brave
  key in the repo (rotate the shared key; `.env` is untracked — keep it so).
- No new discovery track publishes without its unseen-venue evaluation; the
  95% publication-precision target and Wilson-interval reporting stand.
- Every accepted website/resource keeps provenance, evidence, and check time;
  abstention is always preferred over an uncertain publication.
- Licensing review per added source in `DATA-LICENSING.md` (PEC/registry data,
  scraping-based engines, CC-derived domains).

## Relation to other plans

- `ITALY-WEB-ENRICHMENT-PLAN.md` remains the correctness architecture and the
  session record (Sessions 1–10). Its Sessions 11–12 proceed under this plan's
  phases; Brave-based capacity planning is superseded.
- `NEXT-SCALING-SESSION.md` remains the immediate-session handoff (durable
  workflow + unseen validation, offline-only). This plan is what its validated
  output rolls out into.
- `PLAN.md` still describes the single-town pipeline mechanics.
