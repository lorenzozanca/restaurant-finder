# Offline quality benchmark

Run the human-readable evaluator:

```bash
node benchmark/evaluate.mjs
```

For machine-readable output:

```bash
node benchmark/evaluate.mjs --json
```

To evaluate another immutable benchmark manifest, pass
`--benchmark path/to/benchmark.json`. Override one frozen scan with a new scan
using `--scan oderzo=output/oderzo/new-run.json`; the option may be repeated.
`--output path.json` saves the full report. The command performs no network
requests and exits non-zero when a scan contains an unlabelled restaurant row.

Version 1 contains the Oderzo hard-negative set, known good venue/resource
examples, one duplicate group, missing aliases from the latest scan, and five
small stratified regression scenarios. See [`LABELLING.md`](LABELLING.md) for
the acceptance and role rules. `v1/baseline.json` records current behavior and
is guarded by tests; it is a regression reference, not a quality target.

[`SESSION-2-REPORT.md`](SESSION-2-REPORT.md) compares that baseline with the
evidence-based admission snapshot in `v1/session-2.json`.

[`SESSION-3-REPORT.md`](SESSION-3-REPORT.md) documents the versioned output,
field provenance, source-run health, and legacy compatibility work.

[`SESSION-4-REPORT.md`](SESSION-4-REPORT.md) documents deterministic canonical
identity, reversible merge evidence, and the resolved Oderzo duplicate fixture.

Session 5 also has a focused offline enrichment comparison:

```bash
node benchmark/evaluate-enrichment.mjs
```

It replays labelled known-site pages from `v1/session-5-enrichment.json`, checks
that accepted resource links are preserved, and compares website-first search
invocations with the previous search-first minimum.

[`SESSION-5-REPORT.md`](SESSION-5-REPORT.md) records the pipeline change,
instrumentation contract, benchmark result, and verification commands.

Session 6 has a separate official-website calibration fixture:

```bash
node benchmark/evaluate-websites.mjs
```

It measures accepted/review/rejected outcomes, official-site precision and
recall, and confidence-tier precision against wrong-city, wrong-branch,
institutional namesake, canonical-conflict, and directory hard negatives.
[`SESSION-6-REPORT.md`](SESSION-6-REPORT.md) records the thresholds and results.

Session 7 validates each extracted resource independently:

```bash
node benchmark/evaluate-resources.mjs
```

The fixture reports precision and recall for menu, drinks, order, specialty,
and menu-image roles and includes expired, wrong-branch, canonical-conflict,
boilerplate, unrelated-image, and directory hard negatives.
[`SESSION-7-REPORT.md`](SESSION-7-REPORT.md) records the validator contract and
calibration result.

Version 2 freezes the fully reviewed Oderzo pilot denominator and the captured
search-provider failures described in the recall-recovery plan:

```bash
node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
```

It adds venue recall by source class, web-only recall, resource precision and
recall by role, and request-cost reporting. The compact scan is the frozen
2026-08-26 publication set; `v2/oderzo-truth.json` records the current venues,
aliases, known facts, evidence, hard negatives, and review date. Search replay
fixtures under `v2/search-replay` require no provider key or network access.
See [`PHASE-0-1-CHECKPOINT.md`](PHASE-0-1-CHECKPOINT.md) for the measured gaps
and the exact offline verification run.

[`PHASE-2-CHECKPOINT.md`](PHASE-2-CHECKPOINT.md) records provider-owned
scheduling and retries, provider-versioned isolated caching, degraded source
health, removal of implicit scraped-Bing fallback, and the deterministic Phase
2 exit checks. It performs no live acceptance scan and does not begin Session
8 scaling.

Phase 8 has a fail-closed acceptance evaluator:

```bash
node benchmark/evaluate-acceptance.mjs
```

Its checked-in manifest deliberately replays the frozen August 26 scan offline
and therefore returns `NO-GO`. Use `--manifest` with an operator-reviewed
manifest containing two genuinely isolated cold scans and one warm scan. The
evaluator checks the recall, precision, provider-audit, request-budget,
durability, manual-review, and v1-integrity gates together; only a complete
`live-isolated` manifest can return `GO`.
