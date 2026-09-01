# Session 11 durable ownership and unseen-validation checkpoint

Date: 2026-09-01
Decision: **durable workflow passes offline; unseen evaluation is not yet complete**
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

## Deliberately unopened gate

The 100 locked-holdout venues have not been queried or inspected. Development
publisher adjudication is incomplete, so the implementation is not frozen and
the holdout gate has not opened. Automated name/domain similarity is not being
misrepresented as a trusted human ownership decision. No precision, recall,
coverage, abstention, or pass claim is reported yet.

Next work is to independently review the 200 development fixtures, record
publisher class and venue/domain ownership separately with evidence, exercise
the evaluation metrics, freeze the implementation, and only then capture and
evaluate the locked holdout once. If fewer than 73 conclusive holdout
publications are available, even a perfect result cannot put the two-sided 95%
Wilson lower bound at 95%; expand the offline holdout before claiming the
target rather than making any Brave request.

## Integrity checks

- Veneto queue: 13,073 queued, zero attempts, zero terminal jobs.
- National queue: 156,057 queued, zero attempts, zero terminal jobs.
- Pinned Veneto and national Overture SHA-256 checksums match the handoff.
- ISTAT archive and both derived boundary checksums match the handoff.
- Both Overture manifests parse as JSON.
- No live enrichment worker or queue was run.
