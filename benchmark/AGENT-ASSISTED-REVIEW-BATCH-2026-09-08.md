# Agent-assisted ownership review batch — 2026-09-08

Status: **complete; 10 Codex decisions, 5 verified / 5 rejected; 2 websites passed live crawl**

## Why this batch changed

The first phone-operated review exposed that manual one-at-a-time triage is
too expensive for the operator and that the initial UI wrongly required an
approved URL to remain on the candidate's registrable domain. One candidate
was outdated but the operator found the current first-party site; the UI could
not express that correction. The operator stopped manual review and delegated
the bounded evidence review to Codex.

Commit `5db21d8` fixes the interface: an approval may replace an outdated
candidate with a corrected official domain, while rejection remains scoped to
the presented candidate. A blank evidence field now uses the entered website
as its minimum evidence URL. Stored-candidate validation, reviewer identity,
venue scope, audit events, and the ownership publication gate remain intact.

## Safety and scope

- Consistent pre-write backup:
  `/tmp/italy-import-before-agent-review-2026-09-08.sqlite`.
- Review source: bounded OpenAI integrated web research plus direct publisher
  pages; zero Brave requests.
- Reviewer stored as `codex-web-review`; every decision has evidence URLs and
  notes. Broken or ambiguous candidates were left undecided.
- The operator's earlier `visitpiemonte.com` rejection remains intact under
  reviewer `Lorenzo`.
- Review writes touched publisher attestations only. Website/resource facts
  remained at their pre-batch 106 / 154 accepted counts until the separate
  crawl-only step.

## Decisions

Verified:

1. `venue:001003:ala-di-stura:contessine` → `cadjpra.it`; the first-party
   [contact page](https://www.cadjpra.it/contatti.html) names Le Contessine and
   gives Frazione Cresto 82 plus the matching phone.
2. `venue:001006:almese:sul-monte-capretto` →
   `agriturismosulmontecapretto.it`; the [first-party site](https://www.agriturismosulmontecapretto.it/)
   gives Via Muande 12 and the matching phone.
3. `venue:001008:alpignano:bonadies-lago-ristorante` →
   `osterialagobonadies.it`; the [first-party site](https://osterialagobonadies.it/)
   gives Via Almese 99 and the matching phone.
4. `venue:001008:alpignano:farenheit-451-ristorante-pizzeria` →
   `farenheit451.it`; the [publisher's current events page](https://www.farenheit451.it/news-eventi/)
   identifies Ristorante Pizzeria Farenheit 451 in Alpignano.
5. `venue:001006:almese:cope-trattoria-pizzeria` corrected from the stale
   `trattoriapizzerialacope.it` candidate to `trattorialacoperivera.it`; the
   [current first-party site](https://www.trattorialacoperivera.it/) gives the
   exact name and Piazza Comba 16 address.

Rejected as third-party publisher candidates:

1. Pizzeria Arabesco → `facebook.com`.
2. Ristorante Del Sole → obsolete `plus.google.com` / `google.com` profile.
3. Oggi Pizza → `tripadvisor.it` review page.
4. Sesto Senso → shared `metro.bar` hosted profile without verified platform
   control.
5. Ti e Mi → `facebook.com`, with additional source identity/location conflict.

After these decisions the active attestation store contains 190 verified and
6 rejected rows (the sixth rejection is the operator decision).

## Bounded crawl-only follow-up

`enrich-attested.mjs` was added as the reusable execution path. It requires an
existing store and explicit venue IDs, caps a run at 50 venues, refuses venues
without an active attestation, hard-disables official-site and resource-site
search, uses a caller-selected cache outside the repository, reuses fresh
facts by default, and leaves national queue jobs untouched.

The five verified venues were run with three resolver crawls, four resource
validations, one sitemap request, zero site search, and zero official-site
search per venue. Outcomes:

- Accepted website: Agriturismo sul Monte Capretto; no accepted resource.
- Accepted website: Osteria Bonadies; accepted menu page
  `https://osterialagobonadies.it/in-tavola/`.
- Abstained: Le Contessine, Farenheit 451, and corrected La Cope. Their active
  attestations remain, but no website fact was published.
- Total search requests: **0**.

The run exposed misleading resolver wording: a rejected crawl followed by a
configured zero-search budget was labelled `search_budget_exhausted` even
though no search was attempted. The resolver now reports
`crawl_only_candidates_not_accepted` (or `crawl_only_no_candidate`) for future
runs; the status remains fail-closed.

## Resulting national/map state

- Active attestations: **190 verified / 6 rejected**.
- Accepted website facts: **108** (up from 106).
- Resource facts: **155 accepted / 57 rejected / 14 review**.
- `ui/verified-venues.geojson`: **108 features, 67 with menu URLs**.
- Brave requests: **0**.

## Next

This instruction is superseded by
[`VERIFIED-VENUES-SCALING-STRATEGY.md`](VERIFIED-VENUES-SCALING-STRATEGY.md).
Small audited batches are calibration and residual-tail work, not a plan to
review the national inventory sequentially. The next task is the read-only
backlog census. Separately inspect the three crawl abstentions before changing
scoring; review evidence alone must not override a failed live-page gate.
