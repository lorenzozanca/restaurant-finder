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
- 86,852 source website candidates, explicitly marked unverified;
- 112 verified websites;
- 69,205 venues without a source website candidate.

Search accepts an Italian municipality or venue name. At national zoom the inventory
is clustered; zooming in shows individual venues. The status filter switches between
all venues, source candidates, verified websites, rejected candidates, and venues
without candidates.

## One direction

[`PROCESS.md`](PROCESS.md) is the sole active delivery plan. In one sentence:

> Crawl and classify the 86,852 known candidates without search, certify one strict
> automatic first-party verification rule on a frozen holdout, apply it nationally,
> then discover URLs for the remaining 69,205 venues and pass them through the same
> verifier.

Search finds candidates; it does not verify them. Brave is reserved for the unresolved
tail and requires an explicit budget.

## Documentation status

- [`PROCESS.md`](PROCESS.md): current process and next milestone.
- [`DATA-LICENSING.md`](DATA-LICENSING.md): binding source/licensing constraints.
- [`PRIVACY.md`](PRIVACY.md): binding privacy and retention constraints.
- [`docs/archive/`](docs/archive/): superseded plans and handoffs, retained for history.
- [`benchmark/`](benchmark/): historical evaluation evidence and frozen fixtures, not
  current direction.

No other document may redefine the execution order in `PROCESS.md`.
