# Session 12 — start here for the final exam

Role: **designated Stage E final operator**  
Status on entry: **Stages A–D complete; evaluator runs = 0**

## Instructions for the fresh session

Read `benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-FREEZE.json` and
`benchmark/SESSION-12-POWERED-HOLDOUT-EXTENSION-HANDOFF.md` completely.

Then perform Stage E exactly as specified in the handoff:

1. Run the no-evaluator preflight.
2. Stop immediately if any frozen hash, coverage, ordering, uniqueness, schema,
   or evidence-containment check fails.
3. Assemble evaluator-visible copies in the new directory specified by the
   handoff. Do not modify any raw capture or adjudication.
4. Confirm the assembled directories contain no partial, temporary, duplicate,
   extra, or stale fixtures.
5. Run the frozen combined evaluator exactly once.
6. Preserve and report its first output whether the result passes, fails, or is
   inconclusive.

Do not search, directly inspect websites, re-adjudicate, edit a frozen artifact,
remove or replace a venue, change an acceptance threshold, delete an evaluation
result, or rerun the evaluator.

The acceptance rule is fixed: across both 500-venue cohorts, require at least
73 conclusive publications, zero false publications, and a two-sided 95%
Wilson precision lower bound of at least 0.95.

## Copy-paste prompt

> Read `benchmark/SESSION-12-STAGE-E-START.md` and act as the designated Stage E
> final operator. Follow the referenced freeze and handoff exactly. Recheck all
> frozen hashes and exact coverage, assemble the two evaluator-visible cohorts,
> run the frozen combined evaluator exactly once, preserve its first output,
> and report the result. Do not search, re-adjudicate, modify frozen artifacts,
> exclude or replace venues, change the rules, or rerun the evaluator.
