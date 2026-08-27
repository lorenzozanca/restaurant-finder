# restaurant-finder

Given any Italian town name, discover restaurants and collect their menu sources
(website menus, PDFs, photos).

## Usage

```bash
node restaurant-finder/discover.mjs "Oderzo"
node restaurant-finder/discover.mjs "Mogliano Veneto" TV
```

Output lands in `restaurant-finder/output/<town>/<date>.json`.

Operational and compliance documentation:

- [`NEXT-SCALING-SESSION.md`](NEXT-SCALING-SESSION.md) — current verified
  handoff, local Veneto input, provider budget, and next bounded objective.
- [`ITALY-WEB-ENRICHMENT-PLAN.md`](ITALY-WEB-ENRICHMENT-PLAN.md) — correctness-first
  architecture and session-by-session roadmap for national web enrichment.
- [`benchmark/README.md`](benchmark/README.md) — deterministic offline quality
  evaluator, versioned fixtures, and current baseline metrics.
- [`ODERZO-SCAN-REPORT.md`](ODERZO-SCAN-REPORT.md) — scan comparison and the
  evidence behind the national roadmap.
- [`DATA-LICENSING.md`](DATA-LICENSING.md) — source provenance, licences,
  attribution, and redistribution checks.
- [`PRIVACY.md`](PRIVACY.md) — GDPR roles, lawful-basis gate, data-subject
  request procedure, security controls, and retention schedule.
- `node retention.mjs` previews expired files; `node retention.mjs --apply`
  applies the documented retention schedule.

## Architecture

```
restaurant-finder/
├── discover.mjs          # Orchestrator: "give me Oderzo" → JSON
├── lib/
│   └── search.mjs        # Thin wrapper around scripts/search.sh
├── sources/
│   ├── nominatim.mjs     # Resolve town with Nominatim; query venues with Overpass
│   ├── paginegialle.mjs  # Directory results surfaced through web search
│   └── web-search.mjs    # Generic web search discovery
├── find-menu.mjs         # Given restaurant info, hunt for menu
├── output/               # JSON output per location
└── PLAN.md               # This file
```

## Pipeline

### Phase 1 — Discovery (parallel)
Three sources queried simultaneously:
- **OpenStreetMap:** Resolve the requested town once with Nominatim, then make
  one boundary-based Overpass query for structured venue data
- **Web search:** `"ristoranti <town>"` → parses results for restaurant names + websites
- **PagineGialle:** Individual listings surfaced through web-search results

Results are merged and deduplicated by normalized name.

### Phase 2 — Menu hunting (bounded, concurrent workers)
For each selected restaurant (up to 20 by default, configurable with `TOP_N`):
1. If it has a known official website, crawl it for menu, order, specialty,
   PDF, and context-supported menu-image links.
2. Search for venue identity only when that site is missing, unreachable, or
   contains no useful resource.
3. Run the focused menu and loose-identity searches only when earlier search
   results fail the evidence scorer.

Known official websites are crawled before search. Canonical homepage aliases
share crawl work, branch paths remain isolated, and each search fallback records
its reason and request count in the venue and scan enrichment manifests.
Official-site candidates receive separate identity, geography, and officialness
scores. Only accepted decisions are published; uncertain matches remain in
review and geographic or canonical contradictions are rejected.

### Phase 3 — Output
Single JSON file per location, per run. Schema:
```json
{
  "schema_version": 2,
  "location": "Oderzo",
  "searched_at": "2026-08-23",
  "sources_used": ["nominatim", "web_search"],
  "source_runs": [
    {
      "source": "nominatim",
      "status": "succeeded",
      "attempted_at": "2026-08-26T12:00:00.000Z",
      "duration_ms": 1234,
      "result_count": 42
    },
    { "source": "paginegialle", "status": "disabled", "result_count": 0 }
  ],
  "attribution": [
    {
      "source": "OpenStreetMap",
      "notice": "© OpenStreetMap contributors",
      "license": "ODbL-1.0",
      "url": "https://www.openstreetmap.org/copyright"
    }
  ],
  "total_found": 42,
  "with_menu": 8,
  "restaurants": [
    {
      "name": "Trattoria da Mario",
      "type": "trattoria",
      "address": "Via Roma 12, 31046 Oderzo TV",
      "website": "https://trattoriadamario.it",
      "website_decision": {
        "status": "accepted",
        "scores": { "identity": 100, "geography": 70, "officialness": 90 },
        "confidence": "high",
        "evidence": ["exact_name", "municipality_match", "structured_business_data"]
      },
      "phone": "+39 0422 123456",
      "cuisine": "italian",
      "sources": ["nominatim", "web_search"],
      "provenance": {
        "name": [{ "source": "nominatim", "origin": "osm_object" }],
        "website": [{ "source": "nominatim", "origin": "osm_tag", "evidence": ["known_website", "classified_official"] }]
      },
      "resources": [
        {
          "type": "pdf",
          "role": "menu",
          "url": "https://...menu.pdf",
          "found_via": "official_website",
          "source_url": "https://example.it/",
          "evidence": ["same_official_domain", "pdf_url", "reachable_status", "menu_evidence"],
          "http_status": 200,
          "content_type": "application/pdf",
          "resource_confidence": "high",
          "venue_confidence": "high",
          "checked_at": "2026-08-26T12:00:00.000Z"
        }
      ],
      "resource_decisions": [
        {
          "status": "accepted",
          "role": "menu",
          "requested_url": "https://...menu.pdf",
          "final_url": "https://...menu.pdf",
          "http_status": 200,
          "content_type": "application/pdf",
          "checked_at": "2026-08-26T12:00:00.000Z",
          "evidence": ["same_official_domain", "reachable_status", "menu_evidence"]
        }
      ],
      "no_resources_found": false
    }
  ]
}
```

Schema v2 records source health separately from `sources_used` and attaches
field-level provenance to accepted restaurant facts. The UI API normalizes
unversioned legacy scans (schema v1) and returns an explicit error for a future
schema it does not understand.

## Design decisions

- **No Google Maps** — blocked by ToS. OpenStreetMap is the structured source;
  Nominatim resolves the town and Overpass performs the boundary-based venue
  query. Public endpoints remain configurable and are not production SLAs.
- **No social media scraping** — Facebook/Instagram are JS-walled.
- **A restaurant with no online menu is a valid result** (`no_menu_found: true`).
- **Rate-limiting is handled** — search.sh has built-in backoff for Brave's 429s.
- **Reuses existing tooling** — `scripts/lib.mjs` for HTTP, `scripts/search.sh` for web search.
  Zero new dependencies.

## OpenStreetMap configuration

- `NOMINATIM_URL` — compatible Nominatim base URL. The default public service
  is used only for the user-triggered town lookup. Setting a non-public,
  permitted endpoint also enables missing-address coordinate enrichment.
- `OVERPASS_URL` — Overpass interpreter endpoint; defaults to the public
  FOSSGIS instance.
- `OSM_USER_AGENT` — deployment-specific identifying User-Agent. Set this to
  include a contact URL or email before deployment.
