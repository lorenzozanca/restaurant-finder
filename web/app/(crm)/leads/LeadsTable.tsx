"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES, CATEGORY_LABEL, DUE_LABEL, OPEN_STAGES, PIPELINE_STAGES, REGION_NAME, STATUSES, websiteHost,
} from "@/lib/labels";
import { api, Due, formatDay, number, StageTag, StatusDot, useNarrow } from "../ui";

// The leads table: every venue, filtered with the map's parameters plus the CRM ones,
// sorted on the server (LeadIndex.table), loaded 100 rows at a time as the table
// scrolls. Only the rows in view are rendered, so 156,057 rows scroll like 50.

export type Row = {
  i: number; id: string; name: string; category: string; status: string; stage: string; address: string;
  municipality: string; province: string; region: string; phone: string; website: string; checked_at: string;
  next_action: string; next_action_on: string; last_activity_on: string; contacts: number; pomovi_status: string;
};
type Page = { v: string; total: number; offset: number; sort: string; dir: string; items: Row[] };
export type LeadsMeta = { venues: number; regions: { code: string; name: string }[]; provinces: { code: string; region: string }[];
  pomovi: boolean };
type SavedView = { id: string; name: string; query: string };

const PAGE = 100;
const FILTER_KEYS = ["status", "cat", "stage", "region", "prov", "phone", "q", "due", "contacts"];
const MAP_KEYS = ["status", "cat", "stage", "region", "prov", "phone", "q"];

type Column = { key: string; label: string; width: number; sort?: string; num?: boolean; cell: (row: Row) => React.ReactNode };
const COLUMNS: Column[] = [
  { key: "name", label: "Venue", width: 260, sort: "name", cell: (r) => <span className="name">{r.name || "—"}</span> },
  { key: "status", label: "Website status", width: 190, sort: "status", cell: (r) => <StatusDot status={r.status} label /> },
  { key: "stage", label: "Stage", width: 140, sort: "stage", cell: (r) => <StageTag stage={r.stage} /> },
  { key: "next", label: "Next action", width: 240, sort: "next_action_on",
    cell: (r) => (r.next_action_on || r.next_action ? <><Due on={r.next_action_on} /> {r.next_action}</> : null) },
  { key: "last", label: "Last touch", width: 110, sort: "last_activity_on", cell: (r) => formatDay(r.last_activity_on) },
  { key: "contacts", label: "Contacts", width: 96, sort: "contacts", num: true, cell: (r) => (r.contacts ? r.contacts : "") },
  { key: "category", label: "Category", width: 120, sort: "category", cell: (r) => CATEGORY_LABEL[r.category] ?? r.category },
  { key: "town", label: "Town", width: 160, sort: "municipality", cell: (r) => r.municipality },
  { key: "province", label: "Prov.", width: 76, sort: "province", cell: (r) => r.province },
  { key: "region", label: "Region", width: 150, sort: "region", cell: (r) => REGION_NAME[r.region] ?? r.region },
  { key: "phone", label: "Phone", width: 150, cell: (r) => r.phone },
  { key: "website", label: "Website", width: 210, cell: (r) => (r.website ? websiteHost(r.website) : "") },
  { key: "address", label: "Address", width: 240, cell: (r) => r.address },
  { key: "checked", label: "Checked", width: 110, sort: "checked_at", cell: (r) => formatDay(r.checked_at.slice(0, 10)) },
  { key: "demo", label: "Demo", width: 110, cell: (r) => r.pomovi_status },
];
const DEFAULT_COLUMNS = ["name", "status", "stage", "next", "last", "contacts", "category", "town", "province", "phone"];

const BUILT_IN_VIEWS: { name: string; query: string }[] = [
  { name: "All leads", query: "" },
  { name: "Open pipeline", query: `stage=${OPEN_STAGES.join(",")}&sort=next_action_on` },
  { name: "Follow-ups due this week", query: "due=week&sort=next_action_on" },
  { name: "Verified, not in pipeline", query: "status=verified&stage=none&sort=municipality" },
  { name: "Undecided websites to review", query: "status=unresolved&sort=municipality" },
];

const canonical = (query: string) => {
  const params = new URLSearchParams(query);
  params.sort();
  return params.toString();
};

export function LeadsTable({ initialQuery, initial, meta }: { initialQuery: string; initial: Page; meta: LeadsMeta }) {
  const narrow = useNarrow();
  const rowHeight = narrow ? 70 : 40;
  const [query, setQuery] = useState(initialQuery);
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const sort = params.get("sort") || "status";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  // Loaded pages of the current query; `version` drops them when the data changes.
  const pages = useRef(new Map<number, Row[]>([[0, initial.items]]));
  const loading = useRef(new Set<number>());
  const version = useRef(initial.v);
  const current = useRef(query);
  const [total, setTotal] = useState(initial.total);
  const [, setTick] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  useEffect(() => {
    const saved = localStorage.getItem("leads-columns");
    if (saved) setColumns(JSON.parse(saved).filter((key: string) => COLUMNS.some((c) => c.key === key)));
  }, []);
  const visible = COLUMNS.filter((c) => columns.includes(c.key));
  const template = visible.map((c) => `${c.width}px`).join(" ");

  const update = useCallback((change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(current.current);
    change(next);
    const text = next.toString();
    if (text === current.current) return;
    current.current = text;
    pages.current = new Map();
    loading.current = new Set();
    window.history.replaceState(null, "", `/leads${text ? `?${text}` : ""}`);
    setQuery(text);
    scroller.current?.scrollTo({ top: 0 });
    setRange({ start: 0, end: 40 });
  }, []);

  const measure = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    const first = Math.max(0, Math.floor(box.scrollTop / rowHeight) - 10);
    setRange({ start: first, end: first + Math.ceil(box.clientHeight / rowHeight) + 20 });
  }, [rowHeight]);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Back from a venue record: the same query scrolls to where it was.
  useEffect(() => {
    const saved = JSON.parse(sessionStorage.getItem("leads-scroll") || "null");
    if (saved && saved.query === initialQuery && scroller.current) {
      scroller.current.scrollTop = saved.top;
      measure();
    }
  }, [initialQuery, measure]);
  const remember = () => sessionStorage.setItem("leads-scroll",
    JSON.stringify({ query: current.current, top: scroller.current?.scrollTop ?? 0 }));

  // Load the pages that cover the rows in view.
  useEffect(() => {
    const wanted: number[] = [];
    for (let p = Math.floor(range.start / PAGE); p <= Math.floor(range.end / PAGE); p++) {
      if (p * PAGE < Math.max(total, 1) && !pages.current.has(p) && !loading.current.has(p)) wanted.push(p);
    }
    if (!wanted.length) return;
    const timer = setTimeout(() => {
      for (const p of wanted) {
        const forQuery = query;
        loading.current.add(p);
        api<Page>(`/api/crm/leads?${query}${query ? "&" : ""}offset=${p * PAGE}&limit=${PAGE}`).then((page) => {
          if (current.current !== forQuery) return;
          if (page.v !== version.current) {
            version.current = page.v;
            pages.current = new Map();
            loading.current = new Set();
          }
          loading.current.delete(p);
          pages.current.set(p, page.items);
          setTotal(page.total);
          setError("");
          setTick((t) => t + 1);
        }).catch((reason) => {
          loading.current.delete(p);
          setError(`Could not load rows: ${reason.message}`);
        });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [query, range, total]);

  const [panel, setPanel] = useState<"" | "filters" | "columns">("");
  const [views, setViews] = useState<SavedView[]>([]);
  const loadViews = useCallback(() => {
    api<{ items: SavedView[] }>("/api/crm/views?page=leads").then((data) => setViews(data.items)).catch(() => {});
  }, []);
  useEffect(loadViews, [loadViews]);
  const activeView = [...BUILT_IN_VIEWS, ...views].find((view) => canonical(view.query) === canonical(query));
  const savedActive = views.find((view) => canonical(view.query) === canonical(query));

  const [search, setSearch] = useState(params.get("q") || "");
  useEffect(() => {
    const timer = setTimeout(() => update((next) => (search.trim() ? next.set("q", search.trim()) : next.delete("q"))), 250);
    return () => clearTimeout(timer);
  }, [search, update]);

  const filterCount = FILTER_KEYS.filter((key) => key !== "q" && params.get(key)).length;
  const mapParams = new URLSearchParams();
  for (const key of MAP_KEYS) if (params.get(key)) mapParams.set(key, params.get(key)!);
  const filterParams = new URLSearchParams();
  for (const key of FILTER_KEYS) if (params.get(key)) filterParams.set(key, params.get(key)!);

  const setSort = (key: string) => update((next) => {
    if (sort === key) next.set("dir", dir === "asc" ? "desc" : "asc");
    else { next.set("sort", key); next.delete("dir"); }
    if (next.get("sort") === "status" && next.get("dir") !== "desc") { next.delete("sort"); next.delete("dir"); }
  });

  const rows = [];
  const end = Math.min(range.end, total);
  for (let k = range.start; k < end; k++) {
    const row = pages.current.get(Math.floor(k / PAGE))?.[k % PAGE];
    const style = { top: k * rowHeight, height: rowHeight } as React.CSSProperties;
    if (!row) {
      rows.push(narrow
        ? <div key={k} className="card-row loading" style={style}><div className="line1" /></div>
        : <div key={k} className="grid-row loading" style={{ ...style, gridTemplateColumns: template }}>
          {visible.map((c) => <span key={c.key} />)}</div>);
      continue;
    }
    const href = `/venues/${encodeURIComponent(row.id)}`;
    rows.push(narrow
      ? <Link key={k} href={href} prefetch={false} className="card-row" style={style} onClick={remember}>
        <div className="line1"><StatusDot status={row.status} /><span className="name">{row.name}</span><StageTag stage={row.stage} /></div>
        <div className="sub">{row.municipality}{row.province ? ` (${row.province})` : ""} · {CATEGORY_LABEL[row.category]}
          {row.phone ? ` · ${row.phone}` : ""}</div>
        {row.next_action_on || row.next_action
          ? <div className="sub"><Due on={row.next_action_on} /> {row.next_action}</div>
          : row.website ? <div className="sub">{websiteHost(row.website)}</div> : null}
      </Link>
      : <Link key={k} href={href} prefetch={false} className="grid-row" style={{ ...style, gridTemplateColumns: template }}
        onClick={remember}>
        {visible.map((c) => <span key={c.key} className={c.num ? "num" : undefined}>{c.cell(row)}</span>)}
      </Link>);
  }

  const saveView = async () => {
    const name = prompt("Name of this view", savedActive?.name || "");
    if (!name) return;
    try {
      await api("/api/crm/view", { body: { page: "leads", name, query } });
      loadViews();
    } catch (reason) { alert((reason as Error).message); }
  };
  const deleteView = async () => {
    if (!savedActive || !confirm(`Delete the view “${savedActive.name}”?`)) return;
    await api(`/api/crm/view/${savedActive.id}`, { method: "DELETE" }).catch(() => {});
    loadViews();
  };
  // Reads every bridged demo's state from Pomovi, then reloads the rows in view so
  // the Demo column shows it.
  const refreshPomovi = async () => {
    setNotice("Reading from Pomovi…");
    try {
      const { refreshed } = await api<{ refreshed: number }>("/api/crm/pomovi-refresh", { body: {} });
      pages.current = new Map();
      loading.current = new Set();
      setRange((r) => ({ ...r }));
      setNotice(`${refreshed} ${refreshed === 1 ? "demo" : "demos"} read from Pomovi.`);
    } catch (reason) {
      setNotice("");
      setError(`Pomovi: ${(reason as Error).message}`);
    }
  };
  // On a phone these go into a "More" menu, so the rows start higher.
  const actions = (
    <>
      <a className="btn" href={`/map?${mapParams}`}>Show on map</a>
      <button className="btn" type="button" onClick={saveView}>Save view</button>
      {savedActive ? <button className="btn danger" type="button" onClick={deleteView}>Delete view</button> : null}
      <a className="btn" href={`/api/national/export.csv?${filterParams}`} download>CSV</a>
      {meta.pomovi ? <button className="btn" type="button" onClick={refreshPomovi}>Refresh from Pomovi</button> : null}
    </>
  );

  return (
    <>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search a venue or town" value={search}
          onChange={(event) => setSearch(event.target.value)} aria-label="Search a venue or town" />
        <select className="select" aria-label="View" value={activeView ? activeView.query : "custom"}
          onChange={(event) => {
            const view = event.target.value;
            if (view === "custom") return;
            setSearch(new URLSearchParams(view).get("q") || "");
            update((next) => { for (const key of [...next.keys()]) next.delete(key); new URLSearchParams(view).forEach((v, k) => next.set(k, v)); });
          }}>
          {!activeView ? <option value="custom">Custom view</option> : null}
          <optgroup label="Views">{BUILT_IN_VIEWS.map((view) => <option key={view.name} value={view.query}>{view.name}</option>)}</optgroup>
          {views.length ? <optgroup label="Saved">{views.map((view) => <option key={view.id} value={view.query}>{view.name}</option>)}</optgroup> : null}
        </select>
        <button className="btn" type="button" onClick={() => setPanel("filters")}>
          Filters {filterCount ? <span className="badge">{filterCount}</span> : null}
        </button>
        {!narrow ? <button className="btn" type="button" onClick={() => setPanel("columns")}>Columns</button> : null}
        {narrow ? (
          <select className="select" aria-label="Sort" value={`${sort}:${dir}`} onChange={(event) => {
            const [key, direction] = event.target.value.split(":");
            update((next) => { next.set("sort", key); next.set("dir", direction); });
          }}>
            {COLUMNS.filter((c) => c.sort).flatMap((c) => [
              <option key={`${c.sort}:asc`} value={`${c.sort}:asc`}>{c.label} ↑</option>,
              <option key={`${c.sort}:desc`} value={`${c.sort}:desc`}>{c.label} ↓</option>])}
          </select>
        ) : null}
        <span className="count"><b>{number(total)}</b> of {number(meta.venues)}</span>
        {narrow ? <details className="more-menu"><summary className="btn">More</summary><div className="menu">{actions}</div></details> : actions}
      </div>
      {error ? <p className="note err" style={{ padding: "0 12px" }}>{error}</p> : null}
      {notice && !error ? <p className="note" role="status" style={{ padding: "0 12px" }}>{notice}</p> : null}
      <div className="grid-wrap" ref={scroller} onScroll={measure}>
        {!narrow ? (
          <div className="grid-head" style={{ gridTemplateColumns: template }} role="row">
            {visible.map((c) => (c.sort
              ? <button key={c.key} type="button" onClick={() => setSort(c.sort!)} className={sort === c.sort ? "sorted" : undefined}
                style={c.num ? { justifyContent: "flex-end" } : undefined}>
                {c.label}{sort === c.sort ? (dir === "asc" ? " ↑" : " ↓") : ""}
              </button>
              : <span key={c.key}>{c.label}</span>))}
          </div>
        ) : null}
        <div className="grid-body" style={{ height: total * rowHeight }}>{rows}</div>
        {total === 0 ? <p className="note" style={{ padding: "16px" }}>No venues match these filters.</p> : null}
      </div>
      {panel === "filters" ? <FilterPanel params={params} meta={meta} update={update} onClose={() => setPanel("")} /> : null}
      {panel === "columns" ? (
        <ColumnsPanel columns={columns} onChange={(next) => {
          setColumns(next);
          localStorage.setItem("leads-columns", JSON.stringify(next));
        }} onClose={() => setPanel("")} />
      ) : null}
    </>
  );
}

type Facets = { status: Record<string, number>; category: Record<string, number>; stage: Record<string, number> };

function FilterPanel({ params, meta, update, onClose }: {
  params: URLSearchParams; meta: LeadsMeta; update: (change: (next: URLSearchParams) => void) => void; onClose: () => void;
}) {
  const [facets, setFacets] = useState<Facets | null>(null);
  const query = params.toString();
  useEffect(() => {
    api<{ total: Facets }>(`/api/national/summary?${query}`).then((data) => setFacets(data.total)).catch(() => {});
  }, [query]);
  const listOf = (key: string) => (params.get(key) || "").split(",").filter(Boolean);
  const toggle = (key: string, code: string) => update((next) => {
    const values = new Set(listOf(key));
    if (values.has(code)) values.delete(code); else values.add(code);
    if (values.size) next.set(key, [...values].join(",")); else next.delete(key);
  });
  const set = (key: string, value: string) => update((next) => (value ? next.set(key, value) : next.delete(key)));
  const region = params.get("region") || "";
  const chip = (key: string, code: string, label: React.ReactNode, count?: number) => (
    <button key={code} type="button" className="chip" aria-pressed={listOf(key).includes(code)} onClick={() => toggle(key, code)}>
      {label}{count !== undefined ? <span className="n">{number(count)}</span> : null}
    </button>
  );
  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="panel" aria-label="Filters">
        <header>
          <h2>Filters</h2>
          <button className="btn" type="button" onClick={() => update((next) => {
            for (const key of FILTER_KEYS) if (key !== "q") next.delete(key);
          })}>Clear</button>
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </header>
        <div className="panel-body">
          <fieldset className="group"><legend>Website status</legend><div className="chips">
            {STATUSES.map((s) => chip("status", s.code, <><span className={`dot s-${s.code}`} />{s.label}</>, facets?.status[s.code]))}
          </div></fieldset>
          <fieldset className="group"><legend>Pipeline stage</legend><div className="chips">
            {chip("stage", "none", "Not in pipeline", facets?.stage.none)}
            {PIPELINE_STAGES.map((s) => chip("stage", s.code, s.label, facets?.stage[s.code]))}
          </div></fieldset>
          <fieldset className="group"><legend>Next action</legend>
            <select className="select" style={{ width: "100%" }} value={params.get("due") || ""} onChange={(e) => set("due", e.target.value)}>
              <option value="">Any</option>
              {Object.entries(DUE_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </fieldset>
          <fieldset className="group"><legend>Contacts</legend>
            <select className="select" style={{ width: "100%" }} value={params.get("contacts") || ""} onChange={(e) => set("contacts", e.target.value)}>
              <option value="">Any</option><option value="1">Has contacts</option><option value="0">No contacts</option>
            </select>
          </fieldset>
          <fieldset className="group"><legend>Category</legend><div className="chips">
            {CATEGORIES.map((c) => chip("cat", c.code, c.label, facets?.category[c.code]))}
          </div></fieldset>
          <fieldset className="group"><legend>Place</legend>
            <div className="form-row">
              <select className="select" value={region} aria-label="Region" onChange={(e) => update((next) => {
                if (e.target.value) next.set("region", e.target.value); else next.delete("region");
                next.delete("prov");
              })}>
                <option value="">All regions</option>
                {meta.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
              <select className="select" value={params.get("prov") || ""} aria-label="Province" onChange={(e) => set("prov", e.target.value)}>
                <option value="">All provinces</option>
                {meta.provinces.filter((p) => !region || p.region === region).map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
              </select>
            </div>
          </fieldset>
          <label className="check"><input type="checkbox" checked={params.get("phone") === "1"}
            onChange={(e) => set("phone", e.target.checked ? "1" : "")} /> Has a phone number</label>
        </div>
      </aside>
    </>
  );
}

function ColumnsPanel({ columns, onChange, onClose }: { columns: string[]; onChange: (next: string[]) => void; onClose: () => void }) {
  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="panel" aria-label="Columns">
        <header>
          <h2>Columns</h2>
          <button className="btn" type="button" onClick={() => onChange(DEFAULT_COLUMNS)}>Reset</button>
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </header>
        <div className="panel-body">
          <p className="note">Shown on this device. The venue name is always shown.</p>
          {COLUMNS.map((c) => (
            <label key={c.key} className="check">
              <input type="checkbox" checked={columns.includes(c.key)} disabled={c.key === "name"}
                onChange={(e) => onChange(e.target.checked
                  ? COLUMNS.map((x) => x.key).filter((key) => key === c.key || columns.includes(key))
                  : columns.filter((key) => key !== c.key))} />
              {c.label}
            </label>
          ))}
        </div>
      </aside>
    </>
  );
}
