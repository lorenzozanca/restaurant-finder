# Data sources, licensing, and attribution

Last reviewed: 2026-08-27

This document covers data fetched or referenced by Restaurant Finder. It does
not license the source code itself, and it does not replace the terms of any
upstream service. Recheck the linked terms before a public or commercial
release because service policies can change.

## Source register

| Source | Data used | Licence or terms | Required treatment |
| --- | --- | --- | --- |
| [ISTAT municipality register](https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/) | Municipality names and their province names/codes for the scan location picker | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Keep attribution to ISTAT and the licence visible beside the picker. Retain the source, source/retrieval dates, licence, and adaptation notice in `ui/italian-municipalities.json`. The bundled copy uses the official list dated 2026-02-21, retrieved 2026-08-24, and is reduced to names and administrative relationships only. The Sulcis Iglesiente abbreviation is updated from the workbook's `CI` to the current `SU` announced by ISTAT SITUAS. |
| [ISTAT administrative boundaries](https://www.istat.it/notizia/confini-delle-unita-amministrative-a-fini-statistici-al-1-gennaio-2018-2/) | Non-generalized municipality polygons and ISTAT municipality/province/region identifiers used for offline point-in-polygon assignment | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) under Istat's [Open Data terms](https://www.istat.it/dati/open-data/) | Cite `Istituto nazionale di statistica (Istat)`, retain the source URL, geometry and administrative reference dates, checksums, CRS conversion, and adaptation notice. The local 2026-01-01 geometry is reprojected from EPSG:32632 to EPSG:4326; the official 2026-02-21 Castegnero/Nanto merger is applied as a documented temporal crosswalk. Source and derived geometry files stay Git-ignored; their reproducible manifest is tracked. |
| OpenStreetMap, located through Nominatim and queried through Overpass | Venue names, categories, addresses, coordinates, websites, phone numbers, cuisine, and OSM identifiers | OpenStreetMap data is available under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Public services also have separate [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) and [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) usage policies. | Display `© OpenStreetMap contributors` linked to <https://www.openstreetmap.org/copyright>. Preserve the attribution metadata in exported JSON. Assess ODbL share-alike obligations before publicly distributing a database derived from OSM. |
| [Overture Maps Foundation Places](https://docs.overturemaps.org/guides/places/) local extract | Place IDs, names, food categories, addresses, coordinates, websites, phones, confidence, and source references from a pinned bbox extract | Overture's published Places theme is licensed under [CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/), with individual record/source attribution requirements described by Overture. | The scanner and offline importer read only local GeoJSONSeq extracts; they do not query Overture at scan time. Preserve the release, client version, bounding box, checksum, stable IDs, and field provenance; include Overture attribution in generated output; inspect upstream source attribution; and do not assume underlying provider terms permit uses beyond the Overture release. The checked-in Phase 3 file remains an Overture-shaped deterministic adapter fixture, not a current release snapshot. |
| Brave Web Search API results | Result title, URL, and snippet, cached for discovery | No open-data licence is assumed; use is governed by the configured Brave API plan and terms. | Production search requires `BRAVE_SEARCH_API_KEY`. Treat results as limited discovery metadata, honor rate headers, and do not publish cached raw responses. Scraped HTML engines are excluded from production fallback and are available only through explicit diagnostic configuration. |
| [OpenAI integrated web search](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) | Result titles and URLs used only in the frozen Session 11 offline research fixtures | No open-data licence is assumed; use is governed by the applicable OpenAI terms and each linked publisher's terms. This is a research source, not a production provider decision. | Store only the query, normalized candidate URL, short result title, and retrieval time. Do not retain snippets, full pages, credentials, personal contact data, or uncontrolled response caches. Preserve links to the underlying publishers for review and citation. Do not represent these results as equivalent to Brave rankings. |
| PagineGialle links surfaced by web search | Venue name inferred from result metadata, broad location/type, and listing URL | No open-data licence or permission to republish a PagineGialle database is asserted here. Applicable website/database rights and terms must be checked by the operator. | Disabled by default. A diagnostic operator may opt in with `ENABLE_PAGINEGIALLE=1` only after confirming a permitted route. Keep provenance and do not copy listing pages, reviews, images, or a substantial part of the directory. |
| Restaurant and other public websites | Public business name, address, phone, structured metadata, website URL, and links to menus/resources | Facts may not themselves be copyrightable, but page text, photos, menus, branding, and database selections may be protected. Each site retains its own rights and terms. | Store links and minimal factual metadata only. Do not copy or redistribute menu files or images. A link is not a licence; downstream users must follow the destination site's terms. |
| [INI-PEC — Indice nazionale dei domicili digitali](https://www.inipec.gov.it/) | Single PEC address per impresa/professionista, consulted one venue at a time (codice fiscale or provincia + denominazione); only the derived candidate website domain is retained | No open-data licence. Governed by CAD art. 6-bis, D.L. 179/2012, DM 19/03/2013, D.L. 185/2008 art. 16(10), the portal note legali, and Garante provv. 1/2/2018 n. 52. | Single-venue consultation is free without authentication; bulk list extraction is reserved to public administrations. No automated mass querying at national scale. Never store, publish, or redistribute PEC addresses — derived domain plus registry provenance and check date only. No marketing reuse without consent (art. 130 D.Lgs. 196/2003). Reviewed 2026-09-07: verdict single-lookup-only, no bulk. |
| [Registro Imprese / InfoCamere](https://www.registroimprese.it/) and [Unioncamere Open Government](https://opengovernment.unioncamere.gov.it/come-fruire-dei-dati) | No bulk venue-level website/PEC field collected. Aggregate demographics only (backlog sizing); any per-enterprise record only via paid Telemaco document or contracted access | Telemaco/InfoCamere terms: registration plus pay-per-document; resale, informatics distribution, reproduction, and diffusion of extracted documents are forbidden; reuse beyond consultation only via Contratto di Accesso (value-added products, attribution, GDPR compliance). Unioncamere aggregates: generally CC-BY 4.0 — check the per-dataset licence field. | No scraping of registroimprese.it; no redistribution of visure or elenchi. Attribute Unioncamere aggregates per dataset licence. The convenzione bulk route is contractual, not zero-cost — out of scope until the operator approves. Reviewed 2026-09-07: verdict contract-only, no zero-cost bulk. |

## OpenStreetMap service use

Venue discovery no longer sends category searches to the public Nominatim
endpoint. Nominatim resolves the town explicitly requested by the user in one
cached request; one Overpass query then retrieves the relevant OSM objects
inside the resolved boundary. This separates location search from area-based
POI selection and avoids Nominatim's prohibition on systematic POI collection.

Automated address-by-address geocoding is disabled when the configured endpoint
is the public Nominatim service. It is enabled only when `NOMINATIM_URL` points
to a compatible self-hosted or contracted service. `OVERPASS_URL` is also
configurable. Public Overpass instances are best-effort shared infrastructure,
so recurring or multi-user production deployments should use a provider whose
terms cover the expected volume, self-host, or process OSM extracts locally.
The 24-hour HTTP cache reduces repeat requests but is not a substitute for an
appropriate production service.

## Repository behaviour

- Each restaurant record retains `sources`, and OSM records retain `osm_id`.
- Generated JSON includes an `attribution` block for OpenStreetMap.
- The results view and interactive map display OpenStreetMap attribution.
- `output/.cache` may contain copies of HTML or search results. It is an
  internal transient cache, is git-ignored, and must not be distributed.
- The application does not download menu documents or images; it records URLs.

## Redistribution checklist

Before sharing an output file or exposing the UI outside the operating
organisation:

1. Keep the JSON `attribution` block and show the OpenStreetMap credit wherever
   OSM-derived data is viewed. Do not hide it behind user interaction.
2. Decide, with qualified advice where necessary, whether the release is a
   Produced Work, Derivative Database, or Collective Database under the ODbL.
   If share-alike applies, provide the covered database under ODbL 1.0 and a
   practical way to obtain it or the means of recreating it.
3. Confirm the current terms for the configured search provider, PagineGialle,
   Nominatim, Overpass, and every other source added later. Record the review
   date and reviewer in this file or the release record.
4. Exclude cache files, scan logs, and third-party menu/image contents.
5. Complete the privacy release gate in [`PRIVACY.md`](PRIVACY.md), including
   handling sole-trader and individual contact data.

## Registry crosswalk review (2026-09-07)

Question: can INI-PEC / Registro Imprese domains supply `official_registry`
attestations at national scale for zero cost?

Verdict: **no lawful zero-cost bulk track exists**. Automated national-scale
querying of INI-PEC (156k venues) is mass extraction in effect and circumvents
the PA-only bulk rule (D.L. 185/2008 art. 16(10)), the portal note legali, and
the sui generis database right — the Garante banned exactly this pattern
(provv. 1/2/2018 n. 52, 800k+ PECs scraped from INI-PEC/registroimprese.it).
Registro Imprese bulk data is pay-per-document or contract-only (Telemaco
terms forbid redistribution; Contratto di Accesso requires value-added use
plus attribution). Unioncamere open datasets are genuinely open (CC-BY 4.0)
but aggregate-only — no per-enterprise PEC/website records.

Permitted narrow use: manual single-venue INI-PEC consultation by a reviewer
as evidence inside human review (the free "consultazione dei singoli
indirizzi" path). Store the derived domain plus registry provenance and check
date only — never the PEC address (ditta-individuale PECs are personal data;
see `PRIVACY.md` gate). An own-domain PEC yields a *candidate* domain, not an
attestation by itself: email-domain registration does not prove website
control, so the crawl plus venue-scoped ownership gate still apply, and most
PECs sit on provider domains (legalmail, Aruba) yielding no candidate.
Measure yield on a small manual sample before designing the review-queue
"registry hint" field. Open evidence-URL question: the INI-PEC portal is
JS-gated with no stable per-record URL — decide what `evidence_urls` holds
(portal reference plus denominazione/CCIAA/date in notes) before building the
`official_registry` importer path.

## Adding a source

A change that adds a source is incomplete until this register records its
owner, fields collected, licence/terms URL, attribution text, storage limits,
redistribution rules, and personal-data implications. Preserve source-level
provenance in the output so records can be corrected or removed by origin.

The OSMF [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
and [licensing FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)
explain the attribution and database-distribution concepts used above.
