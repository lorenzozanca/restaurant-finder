# restaurant-finder

A national map of Italian food venues, their verified websites, and the sales pipeline
that turns them into Pomovi customers (Pomovi, the sibling repository, builds each
prospect a demo site).

## The two surfaces

**Online lead CRM** (the daily tool): <https://restaurants.trelua.com>, private behind
Google sign-in. The Next.js app in `web/` (Vercel + Neon Postgres) opens on **Leads**,
a table of every venue with the map's filters, sortable columns, and saved views; each
venue has a record page (identity, website verification and manual review, sales stage
and next action, contacts, timeline). **Contacts** and **Activities** list the people
met and every visit, letter, and call; **Map** (`/map`) is the same data on the map.
Setup and operations: [`web/README.md`](web/README.md).

**Laptop** (the verification factory): `node ui/server.mjs`, then
<http://localhost:4188/>. It shows the same map without the pipeline. The laptop owns
crawling, the LLM reviewer batches, and the national store
`data/istat/2026-01-01/derived/italy-import.sqlite`. `node sync-online.mjs` connects
the two: it applies the manual decisions made online to the store, then uploads the map
snapshot and review details.

## What the map shows (2026-09-26, no batch since)

- 156,057 venues in 7,398 municipalities;
- 86,852 source website candidates, unverified until reviewed;
- 5,982 verified websites, 3,294 rejected candidates, 25,818 checked candidates;
- 69,205 venues without a source website candidate.

Search a town or a venue name; filter by lead status, category, region, province,
phone, and (online) pipeline stage; open a venue card to call, visit the website, or
see why the site has its status; **Download CSV** exports the selection or a
reproducible sample. **Review this website** records a manual ownership decision, which
later reviewer batches never overwrite. The layout works on phones and desktops.

## Direction

[`PROCESS.md`](PROCESS.md) is the sole active delivery plan. In short:

> First, finish the CRM so that a lead on the map becomes a Pomovi demo and moves
> through the pipeline to a customer. Second, when the operator asks, verify more
> websites: run the certified LLM reviewer over the remaining known candidates in
> budgeted batches, then discover URLs for the venues that have none.

Search finds candidates; it never verifies them. Every Brave or LLM run requires an
explicit budget.

## Documents

- [`PROCESS.md`](PROCESS.md): the plan and the rules of each track.
- [`STATUS.md`](STATUS.md): the current position and the next executable task.
- [`DATA-LICENSING.md`](DATA-LICENSING.md): binding source/licensing constraints.
- [`PRIVACY.md`](PRIVACY.md): binding privacy and retention constraints.
- [`docs/archive/`](docs/archive/): superseded plans, kept for history.
- [`benchmark/`](benchmark/): frozen evaluation evidence, including the reviewer's
  certification (`benchmark/llm-review-holdout-v1/`).

No other document may redefine the execution order in `PROCESS.md`.
