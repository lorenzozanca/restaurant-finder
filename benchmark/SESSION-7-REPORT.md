# Session 7 resource extraction and validation report

Date: 2026-08-26

Session 7 adds an independent decision for every extracted resource. A valid
official website is no longer sufficient to publish a child link: the child
response must also be reachable, preserve an acceptable redirect/canonical
relationship, carry evidence for its assigned role, and avoid branch,
boilerplate, directory, and unrelated-image contradictions.

Only `accepted` decisions enter `resources`. Plausible external resources with
insufficient venue evidence remain in `resource_decisions` as `review`, while
hard failures remain there as `rejected`. Decisions record requested and final
URLs, status, content type, role, confidence, and evidence. Tracking URL
variants are collapsed before validation and the strongest-evidence variant is
retained.

The extractor now distinguishes `menu`, `drinks`, `order`, `specialty`, and
`menu_image`. It accepts external ordering links when they are linked directly
from an official site, checks JavaScript-rendered discoveries and sitemap
discoveries through the same validator, and verifies PDF and image response
types. The enrichment manifest records resource-validation request counts.

## Offline calibration

The versioned fixture contains one accepted example for every publishable role
and six hard negatives: an expired PDF, wrong-branch redirect, cross-domain
canonical, login boilerplate, unrelated image, and generic directory page.

| Role | Precision | Recall |
| --- | ---: | ---: |
| menu | 100.0% | 100.0% |
| drinks | 100.0% | 100.0% |
| order | 100.0% | 100.0% |
| specialty | 100.0% | 100.0% |
| menu_image | 100.0% | 100.0% |

Overall published precision is 100.0%, with zero hard-negative publications.
The fixture passes the 95% pilot gate, but remains a compact deterministic
regression/calibration set rather than a representative production estimate.

Verification:

```bash
node benchmark/evaluate-resources.mjs
node benchmark/evaluate-enrichment.mjs
node benchmark/evaluate-websites.mjs
node benchmark/evaluate.mjs --benchmark benchmark/v1/session-4.json
node --test
git diff --check
```

Session 5 still retains 4/4 labelled links with zero searches, and Session 6
still reports 100% official-website precision and recall on its frozen fixture.

Next bounded task: Session 8 should add a durable venue/resource/evidence store
and resumable enrichment queue without weakening these publication gates.
