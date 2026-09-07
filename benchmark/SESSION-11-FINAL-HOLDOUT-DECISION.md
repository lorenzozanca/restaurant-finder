# Session 11 final locked-holdout decision

Date: 2026-09-02  
Selection fingerprint: `4a9c84710d6d7478a829c732f52adc50ca7ab12699b03b339a1535e1f6b94079`  
Evaluation report SHA-256: `5b4f9a4a81fd49b259a108f69b40416244d8a94baa01a0888d3db812f031b9a6`  
Decision: **precision authorization gate not passed**  
Publication authorized: **no**

## Capture and adjudication

The final deterministic 100-venue locked holdout was captured after the V3
implementation freeze. Five immutable fixture batches and five separately
stored adjudication batches are under `benchmark/session-11-web-v3/`. They
cover the locked-holdout venue IDs from the final selection exactly once and
retain 79 normalized, query-relevant candidate URLs across 79 publisher
domains. Twenty-one bounded queries have no retained candidate.

The independent review verified 22 publisher domains and rejected 57. Rejected
publishers comprise directories, menu mirrors, booking/order platforms,
editorial/review sites, registries or other unrelated publishers. Chain sites
were accepted only where a retained first-party locator or document identified
the selected branch. A `no_official_site` result means the bounded retained
evidence did not establish a publishable official site; it does not assert that
no official site exists elsewhere on the web.

Before evaluation, set-level schema validation established exact 100/100 venue
coverage and complete review coverage for every retained publisher domain. The
web-fixture and evaluator regression tests both passed. The frozen policy,
registrable-domain helper, evaluator, final selection, and V3 development
report hashes all matched `SESSION-11-WEB-IMPLEMENTATION-FREEZE-V3.json`.

## Exactly-once evaluation

The frozen evaluator was invoked once, after validation, and wrote
`benchmark/SESSION-11-FINAL-LOCKED-HOLDOUT-EVALUATION.json`. It was not invoked
during capture, adjudication, or pre-evaluation validation.

| Metric | Result |
| --- | ---: |
| Reviewed venues | 100 |
| Publications | 22 |
| True publications | 22 |
| False publications | 0 |
| Abstentions | 78 |
| Coverage | 22% |
| Observed official-site precision | 100% |
| Precision Wilson 95% interval | 85.13–100% |
| Observed official-site recall | 100% |
| Search-discovery recall | 100% |
| Non-vacuity | Pass |
| Preregistered precision target | **Fail** |

The observed point estimate is perfect, but the two-sided 95% Wilson lower
bound is `0.8513451253913791`, below the preregistered `0.95` threshold. With
only 22 conclusive publications, the evidence is insufficient to authorize
publication. Resource-role metrics remain explicitly not evaluated because
the minimal fixtures contain no resource-role predictions or adjudications.

No Brave requests or live enrichment workers were used.

## Continuation

Because this failure is underpowered rather than a false-publication failure,
the frozen implementation is unchanged. A new, fixed 500-venue national
holdout has been selected with zero overlap and frozen before search outcomes.
Its design and next gate are recorded in
`SESSION-12-POWERED-HOLDOUT-CHECKPOINT.md` and
`SESSION-12-POWERED-HOLDOUT-FREEZE.json`.
