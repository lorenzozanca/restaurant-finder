# Session 9 checkpoint — national boundaries and importer mode

Date: 2026-08-28
Decision: **National boundary/import path passes; national Places acquisition remains**
Live enrichment: **not started**

## Outcome

The pinned ISTAT 2026-01-01 non-generalized archive now reproducibly produces
one Italy-wide municipality layer. It contains 7,895 current municipalities in
all 20 regions after applying the official Castegnero/Nanto merger effective
2026-02-21.

The generic Overture importer can now run with either one ISTAT region or the
whole country. National mode loads every municipality, reports counts for all
regions, and namespaces canonical venue IDs with the six-digit ISTAT
municipality code so equal municipality and venue names cannot collide.

## Pinned national boundaries

| Item | Result |
| --- | --- |
| Source archive SHA-256 | `a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f` |
| Derived GeoJSON SHA-256 | `b6514449818f13c3252492c1b85f35701523b269fd9d4e192ea7d06f568f0783` |
| Derived bytes | 193,433,758 |
| Municipalities | 7,895 |
| Regions | 20 |
| Envelope | `6.626621418,35.492852585,18.520381593,47.091783741` |

The tracked manifest is
`data/istat/2026-01-01/italy-boundaries.manifest.json`; source and derived
geometry remain Git-ignored.

## Offline smoke evidence

The existing 287,081-record Veneto rectangular extract was processed twice
without a store and without queue writes:

| Boundary scope | Assigned source records | Canonical venues | Municipalities |
| --- | ---: | ---: | ---: |
| Veneto only | 13,113 | 13,073 | 552 |
| All Italy | 19,074 | 19,009 | 965 |

The national result is intentionally larger because the immutable Veneto input
is a rectangle containing neighbouring Italian records. This confirms that the
national boundary index assigns those records rather than discarding them at a
regional envelope. The smoke fingerprint was
`6e30e181b26e99fc1504bc13ec5bf071e0eecf00ba206a7a935c81539eb99848`.

The durable Veneto store was not opened by these smoke runs. Its 13,073 jobs
remain queued, with zero attempts.

## Reproduction

```bash
node prepare-istat-boundaries.mjs \
  --source-directory data/istat/2026-01-01/source \
  --archive-path data/istat/2026-01-01/source/Limiti01012026.zip \
  --expected-archive-sha256 a9075f8d839dcb2b409099703da7bdd37cc214f8967fa7372b32305875ad046f \
  --region-code all \
  --changes-path data/istat/2026-01-01/administrative-changes-through-2026-02-21.json \
  --output-path data/istat/2026-01-01/derived/italy-municipalities.geojson
```

## Next bounded task

Acquire and checksum Overture Places release `2026-07-22.0`, schema `v1.18.0`,
as GeoJSONSeq for the national ISTAT envelope. Do not accept a client download
that silently resolves a newer STAC release. Then run `import-region.mjs` with
the national boundary manifest to create the national inventory and a separate
durable store. Do not start any enrichment worker.
