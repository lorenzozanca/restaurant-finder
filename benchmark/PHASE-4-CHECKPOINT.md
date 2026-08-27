# Search recall recovery Phase 4 offline checkpoint

Date: 2026-08-27
Scope: Phase 4 only
Network requests: none
Session 8 scaling: not started

## Outcome

The scanner now resolves one structured `LocationContext` before source
discovery and passes that same object through OpenStreetMap, the local Overture
adapter, bounded web gap discovery, permitted directory leads, canonical
identity, optional address geocoding, official-site scoring, and resource
validation. Production discovery no longer constructs or reparses a display
string between those layers.

The context retains municipality, province code/name, region, country code,
postcodes, centroid, bbox, and the OSM relation ID when available. Municipality
and province identity are checked against the existing checked-in ISTAT-derived
municipality catalog before the single Nominatim lookup. Same-name
municipalities require the requested province to select a branch. Current scan
documents publish and validate `location_context` while retaining the legacy
top-level `location` and `province` fields for readers of existing v2 output.

The OpenStreetMap formatter now retains postcode, structured address
components, stable provider place ID, and provider record URL. Identity version
2 preserves source aliases and source records, and adds exact postcode,
normalized street-and-number, and provider-place-ID evidence. Exact postcode
is useful supporting evidence but is deliberately insufficient on its own to
corroborate a name. Municipality, postcode, phone, distant-coordinate, and
same-street/different-number conflicts prevent branch merges.

Corroborated matches across OSM, Overture, and permitted directory records
carry an explicit independent-source edge in the merge audit. High-similarity
pairs without an independent factual corroborator remain separate and are
emitted as reversible `identity_review` decisions; no acceptance threshold was
lowered. Website and resource scorers consider every preserved venue alias.

## Phase 4 fixtures

The deterministic fixtures cover:

- `Giardinetto` / `Al Giardinetto` merging through matching structured address
  and street number from independent OSM and Overture-shaped records;
- `Motta di Livenza TV` retaining the full municipality in all focused search
  queries;
- same-name municipalities requiring province disambiguation;
- same-name venues in different municipalities/postcodes remaining separate;
- a wrong branch with a conflicting phone remaining separate despite nearby
  coordinates;
- nearby distinct venues on the same street with different house numbers
  remaining separate;
- exact and core-name-only pairs remaining unpublished and entering review.

## Exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| Giardinetto merges safely with Al Giardinetto | Alias edge plus exact address/street-number and independent structured-source audit edge | Pass |
| Multiword municipality queries retain the full municipality | Nominatim resolution and enrichment query fixtures use `Motta di Livenza` unchanged | Pass |
| No fuzzy-name-only merge is published | Exact/core-name-only fixtures produce separate canonical venues with `identity_review` records | Pass |
| Wrong and nearby branches remain separate | Phone, postcode/municipality, and house-number conflict fixtures | Pass |

## Offline verification

All required deterministic commands completed successfully:

```text
node --test
  22 test files passed, 0 failed

node benchmark/evaluate.mjs
  v1 evaluator completed; 0 unlabelled records; frozen metrics unchanged

node benchmark/evaluate-enrichment.mjs
  100% known-link recall; 100% search reduction in the Session 5 replay

node benchmark/evaluate-websites.mjs
  100% precision and recall in the Session 6 fixture

node benchmark/evaluate-resources.mjs
  100% precision and recall for every Session 7 role

node benchmark/evaluate.mjs --benchmark benchmark/v2/benchmark.json
  frozen Phase 0 metrics unchanged; 0 unlabelled records

node benchmark/evaluate-structured-recall.mjs
  OSM 42/45; OSM + structured fixture 43/45; Phase 3 replay unchanged
```

`git diff --check` completed without errors. A direct `git diff --name-only --
benchmark/v1` assertion was empty. No live discovery, provider call,
cold-cache scan, national import/queue, or Session 8 command was run.

## Dirty-worktree preservation

`git status --short` was captured before implementation and showed the existing
substantial modified and untracked Phase 0-3 and Session 2-7 work. The status
was captured again after verification. Phase 4 adds the location-context module
and tests, extends the existing identity/location/source/schema integration and
tests, and adds this report. Existing changes were not reset, cleaned, staged,
or committed.

No file under `benchmark/v1` was modified. Existing v2 truth, Overture, gap, and
search replay fixtures were not rewritten. Phase 5 resolver work, Phases 6-8,
live acceptance, and Session 8 scaling remain unstarted.
