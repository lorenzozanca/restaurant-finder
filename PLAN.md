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

### Phase 2 — Menu hunting (sequential, top N only)
For each restaurant (up to 15, to stay within budget):
1. If it has a website → crawl it for links containing `menu`, `menù`, `carta`, `listino`, `.pdf`
2. If no menu found on site → web search `"<name> menu ristorante"`
3. If still nothing → web search `"<name> menu pdf"`

### Phase 3 — Output
Single JSON file per location, per run. Schema:
```json
{
  "location": "Oderzo",
  "searched_at": "2026-08-23",
  "sources_used": ["nominatim", "web_search", "paginegialle"],
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
      "phone": "+39 0422 123456",
      "cuisine": "italian",
      "sources": ["nominatim", "web_search"],
      "menu_sources": [
        { "type": "pdf", "url": "https://...menu.pdf", "found_via": "website_links" }
      ],
      "no_menu_found": false
    }
  ]
}
```

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
