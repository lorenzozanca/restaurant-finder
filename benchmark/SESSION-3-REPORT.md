# Session 3 provenance and source-health report

Date: 2026-08-26

New scan output uses `schema_version: 2`. Every source has a `source_runs`
entry with a distinct `succeeded`, `failed`, or `disabled` status, result
count, and (when attempted) timestamp and duration. A successful zero-result
source is therefore distinguishable from an outage. `sources_used` is retained
for compatibility but now lists successful attempts rather than configured
sources.

Restaurant identity fields carry per-field provenance. Official website
selection replaces raw discovery provenance with validation provenance, while
directory URLs retain their original source. Resource records include their
source page, validation evidence, discovery path, confidence, and check time.
Search snippets and fetched bodies remain transient.

The server normalizes unversioned legacy scans as schema v1, including the old
`with_menu` and `menu_sources` names. A scan created by a newer unsupported
schema returns an explicit HTTP 422 error instead of being silently
misinterpreted. The results UI displays source health and schema version.

Verification:

```bash
node --test
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-2.json
```

The offline benchmark remains unchanged by this schema-only session; venue and
resource decisions are still evaluated by the Session 2 frozen snapshot.
