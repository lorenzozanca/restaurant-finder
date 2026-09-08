# Verified-venues scaling strategy

Date: 2026-09-08
Status: **canonical next-session strategy; analysis first, no wholesale run authorized**

## The central clarification

The 156,057 rows are the national venue inventory, not a promise to review
156,057 websites. Manual or agent-assisted batches are **calibration and audit
samples only**. They are not the production scaling mechanism. At three to ten
decisions per batch, reviewing the whole inventory would be impractical and
must not be attempted.

The product target is an honest national inventory with a growing,
high-precision verified layer and an explicit unresolved backlog. Closed,
duplicated, website-less, inaccessible, and evidentially ambiguous venues may
remain unresolved. Coverage should be measured by geography, venue type, and
candidate class, not by pretending every inventory row can receive a website.

## Current state

- National inventory/jobs: 156,057, all still `queued`.
- Source website candidates: 86,852 in the pinned offline inventory analysis.
- Active ownership attestations: 196 verified / 6 rejected.
- Published accepted websites/map features: 112.
- Menu-linked features: 69.
- Publication remains fail-closed: an accepted live page and an active,
  venue-scoped ownership attestation are separate requirements.

## What the completed small batches established

The batches validated the review audit trail, corrected-domain workflow,
attested-only crawler, and independent publication gate. They also exposed the
main candidate classes and common failure modes: exact independent domains,
chain branch pages, venue-controlled hosted pages, booking/directory/social
links, dead domains, moved venues, and conflicting addresses.

That is enough calibration for now. Do **not** continue walking the queue one
venue at a time merely to increase the map count.

## Next work, in order

### 1. Produce a read-only backlog census

Classify the whole inventory without network access or database writes:

- dedicated-looking registrable domains;
- chain domains and repeated domains;
- venue-specific hosted pages/subdomains;
- social, directory, booking, shortener, and generic platform candidates;
- missing website candidates;
- duplicate venue/domain and conflicting-source groups;
- breakdown by region, municipality, and venue type.

Write a reproducible JSON artifact plus a short report containing counts and
percentages. This report determines which scaling tracks are worth building.

### 2. Measure automatic-verification eligibility, without publishing

Build a dry-run evaluator for known candidate URLs. It may report strong
identity corroboration such as exact normalized phone, compatible name, exact
address/postcode, municipality, venue-specific path/subdomain, and absence of
conflicts. Initially it must create no attestations and publish no facts.

Evaluate it against the existing reviewed examples and a frozen, stratified,
previously unseen holdout. Report precision, recall, abstention, candidate
class, and false-positive causes. The existing 95% publication-quality target
remains binding; an inconclusive denominator is not a pass.

### 3. Scale already-authorized evidence methods

Prioritize evidence that fits the current ownership policy:

- verified reciprocal links;
- lawful official-registry data, if any source becomes available;
- official chain branch locators cross-walked by exact branch address/phone;
- owner claims when a claim workflow exists.

Chain-domain reuse should resolve a corporate locator once and match its
branches in bulk rather than search separately for every venue. Whether a
chain-locator match maps onto an existing trusted attestation method must be
documented and tested before writes.

### 4. Consider a new automatic attestation method only as a policy change

The current binding policy says crawled page content alone cannot create
ownership. A proposed `automated_first_party_corroboration` method is therefore
**not currently authorized**. It may be considered only after the dry-run
evaluation, a documented threat model, locked-holdout validation, audit-event
support, expiry/revalidation rules, and explicit policy approval.

If approved, it must require multiple independent high-specificity signals and
fail closed on conflicts. A plausible name or branded-looking domain alone is
never sufficient.

### 5. Keep human/agent review for the residual tail

Manual review is appropriate for moves, corrected domains, ambiguous hosted
pages, identity conflicts, and quality-control samples. Use small audited
batches to test rules or resolve high-value cases—not as a route through the
entire national queue.

## Execution guardrails

- Do not start the 156,057-job national queue wholesale.
- Do not turn failed lookup, timeout, or inaccessible page into rejection.
- Do not infer publisher ownership from page relevance alone under the current
  policy.
- Before national-store writes, take a consistent SQLite backup.
- Keep caches and scratch data outside the repository.
- After any authorized write batch, audit attestation/fact/job deltas,
  regenerate the map, run the full tests, and document the result.

## Definition of the next successful session

The next session succeeds by delivering the reproducible read-only backlog
census and identifying the largest safely automatable candidate classes. It
does not succeed by manually adding a handful of pins.
