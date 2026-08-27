# Search recall recovery Phase 5 offline checkpoint

Date: 2026-08-27
Scope: Phase 5 only
Network requests: none
Session 8 scaling: not started

## Outcome

Official-site resolution is now a bounded state machine in
`lib/official-site-resolver.mjs`. `find-menu.mjs` remains the compatibility
entry point, but it delegates website identity search and candidate selection
to the resolver and performs resource discovery only after a site is accepted.
Search-result menu pages and directories no longer become resource candidates
during website identity resolution.

The resolver first validates a source-provided official URL. If unresolved, it
plans evidence-ordered queries from normalized phone, canonical name and
aliases, municipality, postcode, street, and core-name fallback. Each search
response is ranked, directory/social/blocked domains are excluded from official
candidate crawls, and candidates are crawled in score order. A rejected or
review candidate cannot stop resolution. The only terminal states are
`accepted` and `budget_exhausted`.

The default per-venue budget is two identity searches and three candidate-site
crawls. A third search is rejected unless the caller supplies a
`budget_escalation_reason`; no configuration can exceed three searches or
three candidate crawls. Search attempts, crawl attempts, candidate decisions,
search ranks, cache hits, terminal reason, configured budget, and escalation
reason are retained and schema-validated.

A source-provided website that passes official identity validation is retained
even when it exposes no menu or other resource. That case issues zero website
identity searches. Candidate identity crawls are now separated from resource
discovery: rejected/review candidates do not trigger sitemap work, while the
accepted site can proceed to the existing first-party resource stage.

## Deterministic fixtures

The Phase 5 fixtures cover:

- Al Giardinetto continuing past a plausible wrong hotel namesake, a directory,
  and a review candidate before accepting the correct official site;
- Barhacca selecting the official site returned at search rank seven;
- a directory appearing before an official result without consuming a crawl;
- a review candidate before an accepted candidate without premature stopping;
- a valid known official site with no resources producing zero identity
  searches while remaining published;
- phone-, alias-, address-, municipality-, and postcode-aware query order;
- crawl-budget exhaustion and the prohibition on an unreasoned third search;
- schema rejection when resolver terminal state, budgets, attempts, or
  candidate-decision counts are inconsistent.

## Exit checks

| Exit condition | Deterministic evidence | Result |
| --- | --- | --- |
| Al Giardinetto wrong hotel cannot stop resolution | Wrong hotel rejects, directory is skipped, review continues, correct site accepts | Pass |
| Later-ranked Barhacca official result can be selected | Real scorer/crawler fixture accepts the official rank-seven result | Pass |
| Known official site with no menu avoids generic identity search | Valid Dussin fixture retains website/resources-empty with zero searches | Pass |
| No venue exceeds configured search/crawl budget | Resolver and schema tests enforce <=3 searches, <=3 candidate crawls, and reasoned third search | Pass |

## Offline verification

All required deterministic commands completed successfully:

```text
node --test
  23 test files passed, 0 failed

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

`git diff --check` completed without errors. No live discovery, provider call,
cold-cache scan, national import/queue, or Session 8 command was run.

## Dirty-worktree preservation and non-goals

`git status --short` was captured before implementation and again after final
verification. The pre-existing modified and untracked Phase 0-4 and Session
2-7 work remains present; nothing was reset, cleaned, staged, or committed.
No tool write targeted a file under `benchmark/v1`, and the existing v2 truth
and replay fixtures were not rewritten.

Phase 6 work was not started. In particular, this phase does not add
role-diverse pre-validation caps, sequential sitemap discovery, bounded body
handling, resource freshness logic, or per-stage resource drop metrics. Phases
6-8, live acceptance, and Session 8 scaling remain unstarted.
