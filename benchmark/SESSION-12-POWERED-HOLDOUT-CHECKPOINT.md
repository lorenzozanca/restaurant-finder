# Session 12 powered locked-holdout checkpoint

Date: 2026-09-07  
Status: **selection frozen; capture complete (500/500)**  
Publication authorized: **no**

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
venue IDs, no adjudication has begun, and the evaluator has not been invoked.

Next gate: independently adjudicate every retained publisher domain, assemble
the complete evaluator-visible fixture set, validate exact 500-venue coverage
and all frozen hashes, and only then evaluate exactly once. No Brave request is
authorized.

## Durable resume state

- Last fully captured and selection-order-validated sample index: **500**.
- Capture is complete; do not issue or reopen any Session 12 search query.
- All capture files intentionally retain the `.partial.json` suffix so the frozen
  evaluator cannot load them prematurely.
- Adjudication files created: **0**. Evaluator runs in Session 12: **0**.
- Remove the partial exclusion only as part of assembling exact complete coverage;
  then adjudicate every retained publisher domain, perform the final frozen-hash
  and coverage gate, and invoke the evaluator exactly once.
