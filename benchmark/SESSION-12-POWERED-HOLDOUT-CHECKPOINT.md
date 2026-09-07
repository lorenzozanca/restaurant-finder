# Session 12 powered locked-holdout checkpoint

Date: 2026-09-07  
Status: **selection frozen; capture complete (500/500); adjudication complete (500/500)**
Publication authorized: **no**

The prospective two-cohort continuation and operator responsibilities are
defined in `SESSION-12-POWERED-HOLDOUT-EXTENSION-PLAN.md`. That document is a
plan, not a freeze: no extension search is authorized until its new selection,
protocol, and combined evaluation implementation are frozen.

Session 11 produced 22 correct publications and no false publications, but its
95% Wilson precision lower bound was only 85.13%. The failure was insufficient
power, not an observed false-publication regression. The frozen policy needs at
least 73 flawless conclusive publications to reach the preregistered 95% lower
bound.

The next validation therefore uses a fixed 500-venue holdout, selected before
any of its search outcomes were inspected. It contains 25 venues from each of
20 regions, 260 with and 240 without a source website, and no overlap with the
Session 11 final selection. The selection excluded 1,056 venue IDs appearing in
prior benchmark artifacts.

At the prior 22% publication rate, the fixed sample has 110 expected
publications and a binomial planning probability of 99.9989% of producing at
least 73. This calculation sizes the sample only; it does not alter the
acceptance rule or guarantee a pass.

Selection fingerprint:
`09d36070bdb62e5c64eaa9eada9ca0c240b4deafcfabef091d3ff2eba6645b48`.
The selection and all policy/evaluator hashes are pinned in
`SESSION-12-POWERED-HOLDOUT-FREEZE.json`.

Capture completed in strict selection order. Queries 001–500 are stored in
thirty-four evaluator-excluded partial fixtures under `session-12-web/`;
structural validation confirms exact selection-order coverage of all 500 unique
venue IDs. Independent publisher-domain adjudication now covers venues 001–500
in six adjudication files. The complete adjudication set passes the frozen
schema, evidence-containment, publisher-domain, uniqueness, exact-coverage, and
selection-order gates against an in-memory fixture projection. No Session 12
search query was reopened, all capture files remain evaluator-excluded, and the
evaluator has not been invoked.

Next gate: assemble the complete evaluator-visible fixture set, applying the
frozen 200-character title bound at sample 496, validate exact 500-venue coverage
and all frozen hashes again, and only then evaluate exactly once. No Brave
request is authorized.

## Durable resume state

- Last fully captured and selection-order-validated sample index: **500**.
- Capture is complete; do not issue or reopen any Session 12 search query.
- All capture files intentionally retain the `.partial.json` suffix so the frozen
  evaluator cannot load them prematurely.
- Last fully adjudicated and selection-order-recorded sample index: **500**.
- Adjudication files created: **6**, covering **500/500 venues**, **945 retained
  candidate URLs**, and **853 venue-scoped publisher domains**. Decisions:
  **45 verified**, **798 rejected**, **10 uncertain**; 126 venues have zero
  retained candidates. The 45 verified domains resolve to 44 accepted venues
  because Peterland Olbia has two independently verified first-party domains.
  Evaluator runs in Session 12: **0**.
- Adjudication used only retained URL/title metadata and direct inspection of
  plausible retained candidate URLs. It issued and reopened **0 search
  queries**.
- Pre-evaluation assembly note: the retained title at sample index 496 exceeds
  the frozen 200-character fixture limit, although its URL is normalized. The
  raw partial capture remains untouched; the complete evaluator-visible fixture
  must apply the frozen title bound before the final full-set validation.
- Adjudication artifacts cover exact selection order in these ranges: 001–020,
  021–120, 121–220, 221–320, 321–420, and 421–500. The full in-memory projected
  set validates as 500 venues and 853 publisher domains.
- Frozen-artifact hashes were rechecked after adjudication and all six match the
  freeze manifest exactly.
- Remove the partial exclusion only as part of assembling exact complete coverage;
  perform the final frozen-hash and coverage gate, and invoke the evaluator
  exactly once.
