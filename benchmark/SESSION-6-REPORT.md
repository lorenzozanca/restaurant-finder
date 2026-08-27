# Session 6 official-website selection report

Date: 2026-08-26

Session 6 replaces the blended official-site heuristic with an explainable
decision containing independent identity, geography, and officialness scores.
Only `accepted` decisions are published as official websites. Plausible but
insufficient candidates are retained as `review`; contradictions and known
non-official classes are `rejected`.

The selector now checks the final redirect URL, page canonical URL, structured
business types, phone and street matches, municipality and province evidence,
restaurant context, source-provided status, and first-party resources. A
cross-domain canonical or explicit wrong-city evidence prevents publication.
A changed redirect domain needs exact venue and municipality evidence to remain
accepted. Page bodies remain transient; output contains only scores, outcome,
URLs, and evidence reasons.

## Offline calibration

The versioned Session 6 fixture contains five official sites, one deliberately
uncertain candidate, and five hard negatives: wrong-city namesake, wrong chain
branch, school namesake, cross-domain canonical, and directory listing.

| Metric | Result |
| --- | ---: |
| Official-website precision | 100.0% (5/5 published) |
| Official-website recall | 100.0% (5/5 labelled official) |
| Outcomes | 5 accepted, 1 review, 5 rejected |
| High-confidence precision | 100.0% |
| Medium-confidence precision | 100.0% |

The fixture passes the 95% pilot precision gate. Confidence is non-decreasing
with measured precision, though the small fixture is a regression/calibration
set rather than a statistically representative estimate.

Thresholds are recorded in `v1/session-6-websites.json`. Publication requires
identity at least 55, officialness at least 45, restaurant/business evidence,
and either municipality evidence or a validated source-provided relationship,
with no geographic or canonical contradiction. Scores below that boundary may
enter review but cannot become `website` in published output.

Verification:

```bash
node benchmark/evaluate-websites.mjs
node benchmark/evaluate-enrichment.mjs
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-4.json
node --test
git diff --check
```

Session 5 still preserves 4/4 known-site resource links with zero searches, and
the frozen Session 4 quality baseline is unchanged.

Next bounded task: Session 7 should validate resource response status, redirect
destination, content type, venue identity, branch identity, and role-specific
evidence before publishing each link.
