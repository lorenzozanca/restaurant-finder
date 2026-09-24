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

The current product and execution order are:

1. Keep the national map usable and honest: all 156,057 venues are visible; source
   URLs are labelled candidates until verified.
2. Crawl reliably with no search: Node fetch plus headless Chrome for thin,
   bot-walled, and TLS-rejected pages; persist a crawl assessment for every candidate.
3. Build the LLM ownership reviewer (a cheap OpenRouter triage model and a stronger
   verifier model, with deterministic acceptance of quoted evidence). Develop it on
   the existing labelled data, then certify it once on a new locked holdout drawn
   from the source candidates.
4. If the accuracy gate in `PROCESS.md` passes, run the 86,852 known source candidates
   in resumable zero-search batches, each with an explicit USD cap, and expose
   progress on the map.
5. Only then discover candidates for the 69,205 venues that lack one. Brave is a
   budgeted discovery tool for this residual group, never the verifier.

Do not describe planning, test-fixture preparation, small manual batches, or a backlog
census as delivery progress. Report progress using visible map/database counts and
completed production candidate outcomes.

Never call the old automatic scorer or the failed `strict-first-party-v1` rule
“verified.” The small Oderzo acceptance did not generalize. The later 1,000-venue
result validated an agent-reviewed ownership gate: its labels came from Codex/OpenAI
review, which the operator accepts as reference labels. It did not validate any
automatic classifier. An LLM verdict is not "verified" until the frozen reviewer has
passed its locked holdout. Preserve this distinction in code, documentation, and
operator updates.

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
`STATUS.md` records the current position along that direction.
