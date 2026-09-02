# Session 11 durable ownership and unseen-validation checkpoint

Date: 2026-09-01
Decision: **durable workflow and development adjudication pass offline; locked-holdout evaluation is not yet complete**
Brave requests used: **0**
Publication authorized: **no**

## Completed durable workflow

Evidence schema v4 adds venue- and registrable-domain-scoped publisher
attestations with verified/rejected decisions, approved evidence methods,
attested website, evidence URLs, reviewer, review and expiry times, source kind,
selection fingerprint, lifecycle state, notes, and append-only audit events.

Writes fail closed on missing evidence, unsupported methods, malformed websites,
invalid or future timestamps, expiry before review, cross-venue use, unknown
venues, and sources described as crawled or search-result inference. Active
attestations can be listed, approved/rejected, revoked, and audited through
bounded `queue-ops.mjs` commands. Review commands never create website facts.

The production discovery path now loads active, unexpired attestations from
SQLite before enrichment. The pilot runner idempotently imports accepted
reviews into its isolated evidence store and then uses the same durable path;
it no longer injects review JSON into each in-memory venue. Direct resolver
tests can still provide an explicit trusted dependency.

Both reusable evidence and UI-compatible export suppress websites and their
resources unless the venue has an active, unexpired attestation for the
publisher domain. Revocation takes effect at the next read/export without
deleting the fact or its history.

## Copy-only pilot replay

`benchmark/replay-durable-publisher-ownership.mjs` copied each completed pilot
database to `/tmp`, migrated the copy, imported its pinned reviews, and applied
the durable domain gate. The source databases were opened neither for mutation
nor replay writes.

| Pilot | Reviews imported | Publications | True retained | False rejected |
| --- | ---: | ---: | ---: | ---: |
| Session 10 redone | 17 | 24 | 10/10 | 14/14 |
| Session 10 fresh | 21 | 14 | 5/5 | 9/9 |
| Combined | 38 | 38 | 15/15 | 23/23 |

These remain retrospective regression counts, not an unseen quality estimate.

## Frozen unseen design

`benchmark/SESSION-11-UNSEEN-SELECTION.json` contains 300 unique venue IDs,
15 per region, selected before inspecting their search outcomes. It excludes
156 venue IDs found across both Session 10 pilots and existing JSON benchmarks.
The development/locked-holdout split is 200/100, with 10/5 venues per region.
The selection fingerprint is
`ab0a7a22f2dcc47955db174e9fe769c79c6822bb28fcc85c7195f9566dc19b64`.

The sample includes 160 known and 140 missing source websites, 107/103/90
small/medium/large-municipality venues, 27 chain-labelled venues, 79
language-variant venues, all seven admitted venue types, and 14 explicitly
tourism-focus venues. The manifest pre-registers denominators, two-sided 95%
Wilson intervals, the 95% publication-quality target, non-vacuity, and holdout
retirement rules.

## Development web fixtures

The 200 development queries were captured through Codex integrated web search
in six bounded fixture files under `benchmark/session-11-web/`. They retain
only the query, normalized candidate URL, title (at most 200 characters), and
retrieval time alongside the pinned venue identity. No snippets, page bodies,
credentials, provider cache, or contact details were saved. The fixtures
contain 987 candidate URLs, at most five per venue, and made zero Brave calls.

The minimal-storage decision follows the repository's licensing policy and the
[official OpenAI web-search source interface](https://developers.openai.com/api/reference/cli/resources/responses/methods/create),
which exposes source links separately. OpenAI search is a research source here,
not a production-provider choice and not a proxy for Brave rankings.

An offline pre-labeller marks only obvious third-party publisher classes and
leaves every other domain `uncertain`; it cannot approve ownership. On the
development fixtures it identified 493 directory, 18 booking/order-platform,
and 3 menu-mirror result URLs, leaving 473 for independent review. This is
review triage, not a quality result and not a production host blocklist.

## Locked-holdout gate

The locked holdout was opened only after the implementation freeze. All 100
bounded queries are now durably stored in the original
`session-11-web/locked-holdout-capture-001-008.partial.json` and 23 complete
four-query fixture batches covering queries 009–100. Capture resumed at query
45 without repeating queries 1–44. The original partial capture remains
excluded by the evaluator filename pattern, and the complete capture has not
been adjudicated or evaluated.
Independent development-fixture classification and ownership review are complete. The final
development disposition deliberately retains six venue/domain cases as
uncertain because the available first-party content does not prove publisher
control. The implementation remains frozen. Automated name/domain similarity
is not being misrepresented as a trusted human ownership decision. No holdout
precision, recall, coverage, abstention, or pass claim is reported yet.

The official-site evaluator has now been exercised on development and its
implementation frozen in `SESSION-11-WEB-IMPLEMENTATION-FREEZE.json`. Next
work is to adjudicate the captured locked holdout independently and evaluate it
once. If fewer than 73 conclusive holdout
publications are available, even a perfect result cannot put the two-sided 95%
Wilson lower bound at 95%; expand the offline holdout before claiming the
target rather than making any Brave request.

## Development adjudication complete

Independent bounded-fixture review is complete for development venues 001–200.
Reviews are stored separately from the immutable captures in ten adjudication files
under `session-11-web/` and are validated against the selection fingerprint,
venue IDs, candidate URLs, and complete per-registrable-domain coverage.

The ten batches cover 200/200 development venues, all 987 candidate URLs, and
715 publisher domains. Review of the bounded URL/title metadata and separately
recorded first-party or legal evidence classified 758 URLs as directory results,
ten as menu mirrors, 36 as booking/order-platform, 58 as editorial/review, one
as social, 38 as unrelated, 75 as official, and 11 as uncertain. It rejected
venue ownership for 679 clearly third-party domains, verified 30 publisher
domains, and retained six venue-branded domains as uncertain. The 29 accepted
official websites cover the previously verified chain and independent venues
plus 11 newly verified venues: Pizzeria Ventuno, Da Benito, Caffè Barbarani,
Assaje Udine, Antica Corte Casa Marini, La Corte Cascia, La Casa delle Api
Osteria, Café Les Paillotes, Pino Verde, Hosteria Lu Vic P' Dent, and Agorà
Civita. Verification uses venue or branch content together with identified
legal/operator evidence; the Hosteria case also uses reciprocal first-party
links between its own site and Palazzo Corso Umberto. Domain resemblance and
search-result titles alone were not treated as ownership proof. These are
progress counts, not evaluation metrics.

All captured development fixtures now have complete per-domain review coverage,
including an independent final review of the 18 formerly unresolved ownership
cases. Twelve were verified and six remain deliberately uncertain across Al
Picchio Rosso, both Penny Lane Tavern domains, Oltregusto, Hotel Dolomiti, and
Le Follie dello Chef. The uncertain records carry a review time, reviewed
first-party URLs, and a specific reason. Oltregusto remains uncertain in part
because its live page contains unfinished template placeholders; no compromised
or operator-opaque site was promoted. No locked-holdout result was inspected
during development adjudication, and neither enrichment queue has been run.

Set-level validation rejects duplicate adjudication venues across batches and
requires exact coverage of every fixture venue. Verified ownership must carry
approved evidence, while uncertain ownership must carry an independent review
time, evidence URLs, and a non-empty reason; verification and uncertainty
evidence cannot be mixed. The artifact regression test pins the 200-venue,
987-candidate, 715-domain corpus and its classification totals
(`official=75`, `uncertain=11`) and ownership totals (`verified=30`,
`rejected=679`, `uncertain=6`).

## Development evaluation and implementation freeze

`SESSION-11-DEVELOPMENT-WEB-EVALUATION.json` applies the durable publication
policy to all 200 reviewed development venues. It publishes only independently
verified publisher domains: 29 publications, 29 true, zero false, 171
abstentions, and 14.5% coverage. Official-site precision, recall, and bounded
search-discovery recall are each 100% observed, with a two-sided 95% Wilson
interval of 88.3–100%. The non-vacuity check passes but the precision target
does not: 29 conclusive publications are insufficient for a 95% lower bound.

The evaluator now scores a publication against its per-domain ownership
decision, retains all independently reviewed venues in the coverage and
abstention denominators, reports unresolved publications separately, and
groups false publications by publisher class. The freeze pins the evaluator,
registrable-domain implementation, policy projection, development report, and
selection fingerprint before any holdout capture. Capture resumed at query 9
without repeating queries 1–8, and later at query 45 without repeating queries
1–44. All 100 locked-holdout queries are now captured; no further request is
pending.

The preregistered resource-role metrics remain explicitly not evaluated. The
minimal URL/title fixtures contain neither resource-role predictions nor
resource-role adjudications. This is a scope limitation and prevents a claim
that every preregistered metric is complete; it is not silently counted as a
pass. The freeze authorizes neither publication nor Brave requests.

## Integrity checks

- Veneto queue: 13,073 queued, zero attempts, zero terminal jobs.
- National queue: 156,057 queued, zero attempts, zero terminal jobs.
- Pinned Veneto and national Overture SHA-256 checksums match the handoff.
- ISTAT archive and both derived boundary checksums match the handoff.
- Both Overture manifests parse as JSON.
- No live enrichment worker or queue was run.
