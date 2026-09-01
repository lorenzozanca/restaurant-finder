# Session 10 offline correction report

Date: 2026-09-01
Decision: **offline correction passes; live decision remains NO-GO**
Live requests used: **0**
Publication authorized: **no**

## Scope

This bounded follow-up addresses the defects exposed by the redone Session 10
pilot without resuming its paused warm run or using the 25-request reserve.

The official-site policy now:

- classifies all 14 observed directory, review, tourism, business-listing, and
  editorial hosts as non-official;
- requires an independent first-party signal before a matching venue page can
  be published; name, municipality, restaurant wording, phone, and address
  matches alone establish relevance but not publisher ownership; and
- rejects pages carrying editorial schema even when they repeat valid venue
  identity and location evidence.

All 14 exact false-positive URLs are versioned as regression cases in the
Session 6 website fixture. Applying the new host policy to the historical
pilot's 24 published URLs removes all 14 known false positives and retains its
10 true positives. This is a static regression result, not a new live precision
estimate: a fresh resolver run can inspect later-ranked candidates and must be
evaluated independently.

## Resource-role reconciliation

The pilot labelled Pizza Smile's merchant-controlled Dish ordering surface as
`order`, while the implementation classified its `/menus/dolci` route as
`menu`. Ordering-host semantics now take precedence over route wording, so
menu and product routes on `order`/`delivery` hosts and the supported Dish and
iPratico merchant platforms remain `order` resources.

The exact Pizza Smile mismatch is now a versioned Session 7 regression case.
The remaining novel pilot resource outputs have not received independent
post-run adjudication, so this correction does not publish a revised live
resource precision estimate.

## Offline verification

```text
Website benchmark 1.5.0-session-10-regressions
Official websites: 100.0% precision, 100.0% recall
Outcomes: 5 accepted, 1 review, 19 rejected

Resource benchmark 1.1-session-10-role-reconciliation
Published precision: 100.0%
All five roles: 100.0% precision and recall
Hard-negative publications: 0
```

The full deterministic suite passes 33/33 test files, and `git diff --check`
passes.

## Decision and next gate

Sessions 11 and 12 remain blocked. Do not resume the partial warm run or spend
the reserve. Before reconsidering rollout, independently adjudicate the novel
resource outputs, select and review a fresh pilot sample, obtain a new explicit
Brave allowance, and run a fresh isolated cold/warm pilot against the unchanged
95% publication gates.

## Fresh-pilot authorization

On 2026-09-01, the operator reported approximately 900 Brave requests available
for the month and authorized a new, separate fresh-pilot allowance:

- combined cold/warm hard ceiling: 120 Brave API requests;
- expected use: 80–100 requests;
- fresh sample: about 40 manually reviewed venues, excluding the prior pilot;
- old partial warm run: do not resume;
- Veneto and national queues: not authorized;
- overrun or statistically inadequate sample: stop and report before seeking a
  larger allowance.

The continuation procedure was executed on 2026-09-01 and ended in a fresh
quality NO-GO after 97 requests. This historical authorization does not permit
another run. See `SESSION-10-FRESH-PILOT-REPORT.md`.
