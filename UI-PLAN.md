# restaurant-finder UI

## What to build

A single-page web UI that:
1. Lets me type a town name (+ optional province) and run a scan
2. Shows real-time progress while scanning (restaurants found, menu-hunting step)
3. Shows results: table of restaurants, highlight ones with menus, click to expand menu sources
4. Browses past scans by town (list output/ directories)

## Tech

- Pure HTML + vanilla JS. No build step, no framework, no npm dependencies.
- Served as static files by a minimal Node HTTP server (built-in `node:http` + `node:fs`).
- Port **4188**.
- Progress streamed via **Server-Sent Events (SSE)** — no WebSocket, no polling.

## Files to create

```
restaurant-finder/
├── ui/
│   ├── server.mjs       # static file server + API + SSE scan runner
│   └── index.html       # the whole UI in one file (HTML + CSS + JS)
```

No other files. No `package.json` — the existing `scripts/lib.mjs` is already used by `discover.mjs` and needs no changes.

---

## server.mjs

### Static serving

`GET /` → `ui/index.html` (the SPA).  
`GET /*` → any file under `ui/` (none needed, but keep the door open for future assets).

Map Content-Type from extension:
- `.html` → `text/html; charset=utf-8`
- `.css` → `text/css; charset=utf-8`
- `.js` → `application/javascript; charset=utf-8`
- `.json` → `application/json; charset=utf-8`
- everything else → `application/octet-stream`

Return 404 with `{"error":"not found"}` (JSON) for anything outside `ui/` or missing.

### API endpoints

All API paths start with `/api/`. All responses are JSON. All errors return `{"error":"<message>"}` with an appropriate HTTP status.

#### `POST /api/scan`

Request body: `{"town":"Oderzo", "province":"TV"}` — province is optional.  
Content-Type: `application/json`.

Response: SSE stream (`text/event-stream`).

**SSE event types emitted during the scan:**

| Event | Data shape | When |
|---|---|---|
| `phase` | `{"phase":"discovery"}` | Phase 1 starts |
| `phase` | `{"phase":"menu_hunting"}` | Phase 2 starts |
| `progress` | `{"count": 15, "source":"nominatim"}` | After each source completes in discovery |
| `menu-progress` | `{"n":3,"total":15,"name":"Trattoria da Mario","found":1}` | After each restaurant's menu hunt |
| `result` | full output JSON (same shape as `discover.mjs` writes) | Final event, scan complete |
| `error` | `{"error":"message"}` | Scan process crashes or times out |

**Implementation:**

1. Parse body, validate `town` is a non-empty string (400 if not).
2. Spawn `node ../discover.mjs <town> [<province>]` with `cwd` set to `restaurant-finder/`.
3. Read process stdout line by line. Parse the structured output from `discover.mjs`:
   - `"🏘️  Restaurant Finder"` → `phase: discovery`
   - `"[1/3] Discovering restaurants..."` → `phase: discovery`
   - `"nominatim: N"` → `progress: {count: N, source: "nominatim"}`
   - `"thefork: N"` → `progress: {count: N, source: "thefork"}`
   - `"web search: N"` → `progress: {count: N, source: "web_search"}`
   - `"[2/3] Hunting menus..."` → `phase: {phase: "menu_hunting"}`
   - `"[N/TOTAL] Name ... K sources"` → `menu-progress: {n: N, total: TOTAL, name: "Name", found: K}`
   - `"✅ Done. N restaurants → /path"` → scan done, read the JSON file and send as final `result` event
4. Buffer stderr separately — if the process exits non-zero and no result was sent, emit an `error` event with stderr content.
5. Set a 30-minute timeout on the spawned process (SIGTERM → SIGKILL after 5s).
6. If the client disconnects (request.destroy), kill the spawned process.

**Concurrency:** Only one scan at a time. If `POST /api/scan` is called while a scan is running, return `409 {"error":"Scan already in progress"}`. Track the running process in a module-level variable.

#### `GET /api/scans`

Lists all past scans from `restaurant-finder/output/`.

Response:
```json
[
  {
    "town": "Mogliano Veneto",
    "dates": ["2026-08-23"],
    "restaurants": 15,
    "with_menu": 2
  }
]
```

Walk `output/*/` directories. For each subdirectory:
- Town name = directory name (capitalize first letter of each word).
- List `.json` files inside, extract date from filename.
- Read the JSON to get `total_found` and `with_menu` counts.
- Sort towns alphabetically.

If the output directory doesn't exist, return `[]` (not an error — first run).

#### `GET /api/scan/:town/latest`

Returns the most recent JSON result for a town, or 404.

Town is case-insensitive normalized (lowercase, dash/slash to space). Find the matching directory, sort `.json` files by name descending, return the first one.

#### `GET /api/scan/:town/:date`

Returns `output/<town>/<date>.json` verbatim, or 404.

### Server startup

Log `restaurant-finder UI — http://localhost:4188` on start.  
Handle `SIGTERM`/`SIGINT` — kill any running scan process, then exit.

---

## index.html

### Layout (three-panel)

```
┌──────────────────────────────────────────────────────┐
│  restaurant-finder                     [scan status] │  ← header bar
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  Past      │  Main area:                             │
│  scans     │   - Input form (when idle)               │
│  (sidebar) │   - Progress (while scanning)            │
│            │   - Results table (when done)            │
│            │                                         │
└────────────┴─────────────────────────────────────────┘
```

### Header bar

- Left: "restaurant-finder" in monospace, slightly gray.
- Right: status indicator:
  - Idle: nothing shown.
  - Scanning: animated spinner + "Scanning Oderzo…" + phase description.
  - Done: "15 restaurants, 4 with menus" in green.
  - Error: "Scan failed" in red.

### Left sidebar — Past scans

Always visible (or toggleable via a hamburger on narrow screens).

- Title: "Past scans"
- List of towns, each expanding to show dates.
- Format: `Mogliano Veneto — 2 scans` (collapsed), then `2026-08-23 (15 venues, 2 menus)` (indented, clickable).
- Clicking a date loads that scan result into the main area.
- Clicking the town name sets it in the input form (convenience).
- If no past scans: "No past scans yet." in gray italic.
- Fetched via `GET /api/scans` on page load. Refreshed after a scan completes.

### Main area — States

**State 1: Input form** (initial state, or after clicking "New scan")

```
Scan a town
┌──────────────────────────────┐
│ Town *                       │  text input, autofocus
├──────────────────────────────┤
│ Province                     │  text input, max 2 chars, uppercase
├──────────────────────────────┤
│         [ Scan ]             │  button, disabled if town is empty
└──────────────────────────────┘
```

Placeholder: "Town name (e.g. Oderzo, Mogliano Veneto)"  
Province placeholder: "e.g. TV, RM"

On submit (Enter in town field, or button click):
- Disable inputs and button.
- POST `/api/scan` with `{"town": "...", "province": "..."}`.
- Switch to Progress state.
- On error (409 — scan already running): show a yellow toast "A scan is already running", keep form enabled.

**State 2: Progress** (during scan)

Shows real-time updates via SSE:

```
Scanning Oderzo (TV)…

Discovering restaurants…
  nominatim: 23
  thefork:    8  ↵
  web search: 12  ↵
  38 restaurants after dedup

Hunting menus…
  [3/15] Trattoria da Mario — 1 source ✓
  [4/15] Pizzeria Al Sole — no menu found
  [5/15] Osteria Moderna — 2 sources ✓
  …

```

- Phase lines update as SSE `phase` events arrive.
- Source counts update as `progress` events arrive.
- Menu-hunting lines append as `menu-progress` events arrive (auto-scroll to bottom).
- Restaurants with menus get a green ✓, without get a gray —.
- Show an elapsed timer (mm:ss) that started when the scan began.

**State 3: Results** (scan complete)

```
Oderzo (TV) — 38 restaurants, 7 with menus ✓
Scanned 2026-08-23 from nominatim, thefork, web_search

┌──────────────────────────────────────────────────────────────────┐
│  #  │ Name                │ Type       │ Menu │ Sources         │
├──────────────────────────────────────────────────────────────────┤
│  1  │ Al Solito Posto     │ restaurant │  ✓   │ 2 sources ▸     │
│  2  │ Bar Centrale        │ bar        │  —   │ —               │
│  3  │ Da Mario            │ trattoria  │  ✓   │ 1 source ▸      │
│  …  │ …                   │ …          │  …   │ …               │
│ 38  │ Zio Peppe           │ pizzeria   │  —   │ —               │
└──────────────────────────────────────────────────────────────────┘

[ New scan ]   [ Download JSON ]
```

- Table sorted alphabetically by name.
- "Menu" column: green ✓ if `no_menu_found === false`, gray — otherwise.
- "Sources" column: count + clickable expand arrow (▸).
- Clicking a row (or the arrow) expands it inline to show menu sources:

```
  ▾ Da Mario — 2 sources
    • pdf       website_links    https://damario.it/menu.pdf
    • webpage   web_search       https://damario.it/lista
```

- Each source line is: type badge (pdf/webpage) + found_via badge + clickable URL (opens in new tab).
- "Download JSON" button: triggers a download of the result as `.json` file via `Blob` + `URL.createObjectURL`.
- "New scan" button: returns to input form.

**State 4: Viewing past scan**

Same layout as State 3 (results), but fetched from `GET /api/scan/<town>/<date>` instead of an SSE stream.  
Shows "[ New scan ]" button at the bottom.

**State 5: Error**

If the scan process crashes or the SSE stream sends an `error` event:

```
✕ Scan failed
  <error message from stderr>

[ Try again ]
```

"Try again" returns to input form with the previous town/province pre-filled.

### Design

- Dark background (`#111` or `#1a1a2e`), light text (`#e0e0e0`).
- Monospace font stack: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace`.
- No images, no icons (except unicode: ✓ — ▸ ▾ ✕).
- Accent color: green (`#4ade80`) for success/highlights, red (`#f87171`) for errors, yellow (`#fbbf24`) for warnings.
- Max width: 1100px, centered. Sidebar: 260px.
- Table uses alternating subtle row backgrounds (`#1e1e2e` / `#252540`).
- Smooth transitions between states (fade, 200ms).
- Responsive: on screens narrower than 700px, the sidebar collapses to a top bar with a dropdown. Input fields stack vertically.

### JS Architecture

Single `<script>` block at the bottom of `<body>`. No modules, no imports — everything in one closure to keep it simple.

Key objects/functions:

```
state = {
  currentView: 'input' | 'progress' | 'results' | 'error',
  scanRunning: false,
  currentScan: { town, province },
  pastScans: [],
  results: null,
  eventSource: null,
}

API:
  api(method, path, body?) → Promise<response>
  streamScan(town, province) → EventSource  (SSE)

Views:
  showInput()        — render input form
  showProgress()     — clear main, start appending SSE events
  showResults(data)  — render results table
  showError(msg)     — render error state

SSE handler:
  onPhase(phase)
  onProgress({count, source})
  onMenuProgress({n, total, name, found})
  onResult(data)
  onError(msg)

Rendering:
  renderTable(restaurants)
  renderMenuSources(sources)  — expandable row detail
  renderSidebar()             — past scans list
```

### Implementation order

1. **server.mjs — static serving.** Get `GET /` returning index.html and 404 for missing files. Verify it opens in a browser.
2. **server.mjs — `/api/scans`.** Walk the output directory, return JSON. Test with `curl`.
3. **server.mjs — `/api/scan/:town/latest` and `/api/scan/:town/:date`.** Return stored JSON.
4. **server.mjs — `/POST /api/scan` + SSE.** Spawn discover.mjs, parse stdout, emit SSE events. Test with `curl -N`.
5. **index.html — shell.** HTML structure, CSS, three-panel layout, state switching via JS.
6. **index.html — input form + scan trigger.** POST to server, handle SSE stream.
7. **index.html — progress view.** Render SSE events in real time.
8. **index.html — results view.** Table, expandable rows, download button.
9. **index.html — past scans sidebar.** Fetch on load, click to view, click town to pre-fill.
10. **Polish.** Elapsed timer, error handling, responsive sidebar collapse.

## To run

```bash
node restaurant-finder/ui/server.mjs
# → http://localhost:4188
```

## Things the session needs to know

- `restaurant-finder/discover.mjs` exists and works — run it with `node discover.mjs <town> [province]` from the `restaurant-finder/` directory.
- Output lands in `restaurant-finder/output/<town>/<date>.json`.
- The script can take 2–10 minutes depending on town size and search engine rate limits.
- `discover.mjs` writes progress to stdout — the server parses this for SSE.
- The existing `viewer/` directory is for research findings (competitor profiles etc.), not for restaurant-finder — don't touch it.
- `scripts/lib.mjs` provides `get()` and `getRendered()` — used by `discover.mjs`, not by the UI server.
- The UI server uses only Node built-ins: `node:http`, `node:fs`, `node:path`, `node:child_process`.
- No `npm install` needed. No `package.json` changes needed.