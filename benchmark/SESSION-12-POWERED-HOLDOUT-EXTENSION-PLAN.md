# Session 12 powered locked-holdout extension plan

Date: 2026-09-07  
Status: **planning only; extension not yet frozen; no new search authorized**  
Target: **two separately frozen 500-venue cohorts, evaluated once as a pooled
1,000-venue validation**

## Why the extension is needed

The first Session 12 cohort is fully captured and adjudicated. It contains 500
venues but only 44 accepted venues across 45 verified publisher domains. Even
if all 44 publications are correct, that cohort cannot meet the preregistered
minimum of 73 flawless conclusive publications needed for a two-sided 95%
Wilson precision lower bound of at least 0.95.

The Session 11 result supplies useful supporting evidence, but retroactively
pooling its 22 publications with Session 12 would not satisfy the currently
frozen Session 12 rule and would still yield only 66 publications. The clean
next step is a prospectively specified second cohort.

## Non-negotiable invariants

- Do not modify or replace the original Session 12 selection, freeze manifest,
  partial captures, adjudications, or frozen evaluator.
- Do not open a second-cohort search until its selection, exclusions, query
  protocol, and combined evaluation rule have been frozen in new artifacts.
- Select exactly 500 new venues with no overlap with either the first Session 12
  cohort or any venue excluded by the original benchmark lineage.
- Preserve separate selection fingerprints and provenance for the two cohorts.
  Do not rewrite the first cohort to carry a combined fingerprint.
- Use the same bounded query templates, search provider/interface, locale
  assumptions, result limits, URL normalization, and title capture policy used
  for the first cohort.
- Only Codex performs live searches or direct web inspection. Other agents must
  not supplement the bounded captures with results from different search tools.
- Never reopen a completed search query. Save retained URL/title results in
  strict frozen selection order using evaluator-excluded `.partial.json` files.
- Do not run the evaluator during selection, capture, adjudication, integration,
  or preflight. There is one authorized evaluator execution, after both cohorts
  are complete.
- A failed or inconclusive final result is reported as such. No post-result
  extension, replacement, or selective exclusion is permitted.

## Stage A — freeze the extension before search

Codex will create a new extension selection and freeze manifest. The freeze
must record:

- the original cohort fingerprint and all original frozen hashes;
- the second cohort's 500 ordered venue IDs and fingerprint;
- exclusion evidence proving no cross-cohort or historical overlap;
- the sampling and regional-stratification rules;
- the unchanged bounded-search protocol;
- zero second-stage queries opened at freeze time;
- a combined evaluator or aggregation implementation capable of validating two
  separate fingerprints without weakening either cohort's provenance;
- the pooled acceptance rule: evaluate all conclusive publications across the
  fixed 1,000 venues, require at least 73 flawless publications, and require the
  two-sided 95% Wilson lower bound for conclusive official-site precision to be
  at least 0.95;
- one authorized combined evaluator execution.

The second cohort should retain the original 25-venues-per-region structure
unless an unavoidable inventory constraint is identified and documented before
selection is frozen.

## Stage B — Codex search capture

After the extension freeze passes its pre-search audit, Codex will execute the
500 second-stage searches in exact selection order.

- Captures may be written in small durable files as required for recovery, but
  progress handoffs should normally cover 100 venues rather than 20.
- Every capture checkpoint must confirm continuous sample-index coverage, unique
  venue IDs, normalized retained URLs, the selection fingerprint, and continued
  evaluator exclusion.
- Search failures are recorded under the frozen retry policy. They are not
  replaced with searches from another provider or another agent.
- No evaluator-visible fixture is assembled during capture.

## Stage C — Codex publisher-domain adjudication

Codex will adjudicate every retained registrable domain in the second cohort.

- Obvious directories, maps, review sites, menu mirrors, booking/order platforms,
  social sites, and unrelated publishers are rejected from retained metadata.
- Plausible first-party candidates are inspected only by directly opening their
  retained URLs. No new search query may be issued during adjudication.
- Ownership is verified only when retained first-party content identifies the
  selected venue or exact chain branch.
- Failed direct inspections follow the bounded retry rule and become uncertain
  when the retained evidence cannot establish publisher control.
- Decisions include reviewer identity, evidence URLs, timestamps, publisher
  class, and ownership status.
- Adjudication artifacts should normally be delivered in 100-venue ranges and
  must cover the second cohort in exact selection order.

Offline agents may inventory domains, propose obvious classifications, inspect
schema consistency, and audit counts. Codex remains responsible for the final
web-dependent judgment and adjudication record.

## Stage D — Codex pre-evaluation handoff

Codex's phase is complete only when all of the following are true:

- both selections total exactly 1,000 unique, non-overlapping venues;
- all 1,000 venues have capture and adjudication coverage in selection order;
- every retained publisher domain has exactly one adjudication;
- all evidence URLs are contained within the appropriate bounded capture;
- all capture files remain evaluator-excluded;
- the known overlong title at first-cohort sample 496 has a documented,
  deterministic 200-character projection rule for final assembly while its raw
  capture remains untouched;
- all original and extension hashes match their freeze manifests;
- schema, uniqueness, ordering, evidence-containment, and projected full-set
  validations pass;
- searches reopened remain zero and evaluator runs remain zero;
- the checkpoint identifies the exact final assembly and evaluator command but
  does not execute it.

At that point Codex writes a durable checkpoint for the final operator.

## Stage E — final operator

A designated final agent may finish the benchmark without using a live search
tool. That agent must:

1. Read both freeze manifests and the final Codex checkpoint.
2. Recheck every frozen hash and exact cross-cohort coverage.
3. Assemble evaluator-visible fixtures without modifying raw captures.
4. Apply only the preregistered title-bound projection.
5. Confirm that no extra, partial, duplicate, or stale fixture can be loaded.
6. Run the combined frozen evaluator exactly once.
7. Preserve and report the complete output whether it passes, fails, or is
   inconclusive.

The final agent must not search, re-adjudicate after seeing the score, change the
acceptance rule, remove difficult venues, or rerun the evaluator.

## Responsibility boundary

### Reserved for Codex

- extension protocol and pre-search freeze;
- all second-cohort live search capture;
- all direct inspection of retained plausible first-party URLs;
- final publisher-domain adjudication decisions;
- combined pre-evaluation validation and durable handoff.

### Safe for other agents

- offline selection and overlap audits;
- domain normalization and inventory checks;
- suggested classification of obvious third-party publishers;
- schema, order, hash, count, and statistical audits;
- code review and non-evaluator tests;
- final fixture assembly and the single evaluator execution, but only after the
  Codex handoff explicitly authorizes that stage.

## Immediate next action

Create and validate the extension selection and freeze artifacts. Until that
freeze is complete, the first new search remains unauthorized.
