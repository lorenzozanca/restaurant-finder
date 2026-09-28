# Repository instructions for every agent

Before planning or changing this repository, read `PLAN.md`, `PROCESS.md`, and
`STATUS.md` completely, in that order. Then inspect `git status` and the latest commit.

When the operator says **continue**, resume the `Next executable task` in `STATUS.md`
without asking them to restate the project or choose between alternatives. Ask only
when an external permission, money, credentials, or a genuinely product-changing
decision is required.

`PROCESS.md` is the sole active delivery plan. Do not create a competing roadmap,
session plan, strategy, or handoff. Update `PROCESS.md` only when an implemented and
verified result changes the current state or execution order.

Documents under `docs/archive/` and evaluation material under `benchmark/` are
historical evidence. They may explain prior decisions, but they are not current
instructions and must not supersede `PROCESS.md`.

The project has two tracks. The order is the operator's decision (2026-09-28):

1. **Online lead CRM (primary).** The private app in `web/`
   (<https://restaurants.trelua.com>) that turns venues into Pomovi prospects:
   map, manual review, sales pipeline, and the Pomovi bridge. See `PROCESS.md` →
   "Online lead CRM". It never changes what counts as verified: online manual
   decisions reach the national store only through `sync-online.mjs` and
   `recordReviewDecision`.
2. **Website verification (secondary, only when the operator asks).** Keep the
   national map honest (all 156,057 venues are visible; source URLs are candidates
   until verified). Run the certified reviewer over the remaining known source
   candidates in resumable zero-search batches, each approved by the operator with an
   explicit USD cap. Only after that, discover candidates for the 69,205 venues that
   lack one. Brave is a budgeted discovery tool for that group, never the verifier.

Do not describe planning, test-fixture preparation, small manual batches, or a backlog
census as delivery progress. Report progress with visible map/database counts,
completed production candidate outcomes, and working CRM features on the live app.

"Verified" means one of two routes only: a manual review, or an outcome of the frozen
LLM reviewer certified on locked holdout v1
(`benchmark/llm-review-holdout-v1/REVIEWER-FREEZE.json`). A changed model, prompt, or
decision code is a new reviewer and needs a new locked holdout before its outcomes
count. Never call the old automatic scorer or the failed `strict-first-party-v1` rule
"verified". Preserve this distinction in code, documentation, and operator updates.

Every OpenRouter (LLM) run needs an explicit USD cap (default $5). Never start one
without an `OPENROUTER_API_KEY` supplied by the operator and a cap.

## Required end-of-session handoff

Before ending any implementation session:

1. Run verification proportional to the change and record the exact command/result in
   `STATUS.md`.
2. Update `STATUS.md` with what actually shipped, current counts, blockers, and one
   unambiguous `Next executable task`. Do not record aspirations as completed work.
3. Commit the coherent, verified unit of work. Include only files belonging to the
   active task; preserve unrelated operator changes.
4. Leave the worktree clean. If that is impossible because unrelated changes already
   exist, document them in `STATUS.md` and do not modify or commit them.

`STATUS.md` is an execution ledger, not a second plan. `PROCESS.md` defines direction;
`STATUS.md` records the current position along that direction. Keep it short: replace
outdated entries instead of appending to them, and keep only the latest verification.
Older detail lives in git history.
