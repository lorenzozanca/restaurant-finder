# restaurant-finder

The product is a national, searchable map of Italian food venues and their website
verification state.

## Start the product

```bash
node ui/server.mjs
```

Open <http://localhost:4188/map.html>.

The map reads the national store at
`data/istat/2026-01-01/derived/italy-import.sqlite` and currently shows:

- 156,057 venues;
- 86,852 source website candidates, unverified until reviewed;
- 2,265 verified websites (2026-09-25, after two 5,000-candidate batches);
- 1,289 rejected candidates and 10,000 assessed candidates;
- 69,205 venues without a source website candidate.

Search accepts an Italian municipality or venue name. At national zoom the inventory
is clustered; zooming in shows individual venues. The status filter switches between
all venues, source candidates, verified websites, rejected candidates, and venues
without candidates.

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
