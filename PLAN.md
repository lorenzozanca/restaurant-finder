# restaurant-finder

Given any Italian town name, discover restaurants and collect their menu sources
(website menus, PDFs, photos).

## Usage

```bash
node restaurant-finder/discover.mjs "Oderzo"
node restaurant-finder/discover.mjs "Mogliano Veneto" TV
```

Output lands in `restaurant-finder/output/<town>/<date>.json`.

## Architecture

```
restaurant-finder/
├── discover.mjs          # Orchestrator: "give me Oderzo" → JSON
├── lib/
│   └── search.mjs        # Thin wrapper around scripts/search.sh
├── sources/
│   ├── nominatim.mjs     # OpenStreetMap venues (free API, JSON)
│   ├── thefork.mjs       # TheFork via search engine
│   └── web-search.mjs    # Generic web search discovery
├── find-menu.mjs         # Given restaurant info, hunt for menu
├── output/               # JSON output per location
└── PLAN.md               # This file
```

## Pipeline

### Phase 1 — Discovery (parallel)
Three sources queried simultaneously:
- **Nominatim (OpenStreetMap):** Structured data — name, type, address, website, phone, cuisine
- **TheFork:** Crawled via `site:thefork.it ristoranti <town>` search
- **Web search:** `"ristoranti <town>"` → parses results for restaurant names + websites

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
  "sources_used": ["nominatim", "thefork", "web_search"],
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
      "sources": ["nominatim", "thefork"],
      "menu_sources": [
        { "type": "pdf", "url": "https://...menu.pdf", "found_via": "website_links" }
      ],
      "no_menu_found": false
    }
  ]
}
```

## Design decisions

- **No Google Maps** — blocked by ToS. Nominatim/OSM is the free structured source.
- **No social media scraping** — Facebook/Instagram are JS-walled.
- **A restaurant with no online menu is a valid result** (`no_menu_found: true`).
- **Rate-limiting is handled** — search.sh has built-in backoff for Brave's 429s.
- **Reuses existing tooling** — `scripts/lib.mjs` for HTTP, `scripts/search.sh` for web search.
  Zero new dependencies.