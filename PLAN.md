# restaurant-finder

The product is a national, searchable map of Italian food venues and their website
verification state.

## Start the product

```bash
node ui/server.mjs
```

Open <http://localhost:4188/> (it redirects to `/map.html`; the map is the only page).

The map reads the national store at
`data/istat/2026-01-01/derived/italy-import.sqlite` and currently shows:

- 156,057 venues;
- 86,852 source website candidates, unverified until reviewed;
- 5,979 verified websites (2026-09-26, after four national batches and one Veneto batch);
- 3,291 rejected candidates and 25,796 assessed candidates;
- 69,205 venues without a source website candidate.

The map is built for phones as well as desktops (from another device, open it at the
server's Tailscale address). Search a town to jump there, or a venue name to filter by it.
Bubbles cluster venues by screen distance; a green arc shows each bubble's share of
verified websites; tap a bubble to zoom in, or a dot for the venue card (call, website,
maps). Filters: lead status (verified, rejected, directory or social link, checked but
undecided, unreachable, not checked yet, no website), category, region, province, and
phone. The list shows the venues in view, and **Download CSV** exports the selection or
a reproducible random sample. Filter state is kept in the URL.

Every venue card with a website shows why it has its status: the crawl result, the
LLM reviewer's reason and which identity quotes it found, and earlier decisions.
**Review this website** records a manual ownership decision (official or not, with the
corrected site, evidence pages, and your name). An approval publishes the website as
verified (`manual_first_party_review`); the map updates a few seconds later, and later
reviewer batches never overwrite a manual decision. To work through a backlog, filter
to **Undecided** in a region and go down the list.

The server answers from a compact snapshot of the store
(`italy-import.map-snapshot.json`). `publish-national-review.mjs` rebuilds it after
publishing, and the server rebuilds it in the background whenever the store changes
(`node build-map-snapshot.mjs` does it by hand). `node ui/map-mobile-check.mjs
[--desktop]` checks the page in headless Chrome as a phone on 4G, recording timings and
screenshots.

## One direction

[`PROCESS.md`](PROCESS.md) is the sole active delivery plan. In one sentence:

> Crawl every known candidate reliably without search, certify one LLM ownership
> reviewer (cheap triage model plus stronger verifier, with quoted evidence checked
> deterministically) on a new locked holdout, apply it to the 86,852 known candidates
> under explicit spending caps, then discover URLs for the remaining 69,205 venues
> and pass them through the same verifier.

Search finds candidates; it does not verify them. Brave is reserved for the unresolved
tail, and every Brave or LLM run requires an explicit budget.

## Documentation status

- [`PROCESS.md`](PROCESS.md): current process and next milestone.
- [`DATA-LICENSING.md`](DATA-LICENSING.md): binding source/licensing constraints.
- [`PRIVACY.md`](PRIVACY.md): binding privacy and retention constraints.
- [`docs/archive/`](docs/archive/): superseded plans and handoffs, retained for history.
- [`benchmark/`](benchmark/): historical evaluation evidence and frozen fixtures, not
  current direction.

No other document may redefine the execution order in `PROCESS.md`.
