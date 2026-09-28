import { createHash } from "node:crypto";
import { buildClusterIndex, projectX, projectY, tileItems } from "./map-cluster.mjs";
import { CATEGORIES, PIPELINE_STAGES, REGIONS, STATUSES } from "./map-constants.mjs";

// In-memory query layer over a map snapshot: filters, cached cluster indexes,
// tiles, facet counts, the venue list, details, and CSV export. Everything is a
// scan over typed arrays or a lookup in a prebuilt cluster index; nothing touches
// SQLite.

const CLUSTER_CACHE_SIZE = 12;
const STATUS_CODES = STATUSES.map((status) => status.code);
const CATEGORY_CODES = CATEGORIES.map((category) => category.code);
// Stage filter codes; the index is the stage value in LeadIndex.stage (0 = not in the pipeline).
const STAGE_CODES = ["none", ...PIPELINE_STAGES.map((stage) => stage.code)];
const VERIFIED = STATUS_CODES.indexOf("verified");
export const LIST_PAGE_MAX = 200;
// CRM table filters: when the next action falls (`none` = in the pipeline without one).
export const DUE_CODES = ["overdue", "today", "week", "any", "none"];
// Table sort keys. Every order is total (ties fall back to name, then position), so
// paging never loses or repeats a row; empty values sort last in both directions.
export const TABLE_SORTS = ["name", "municipality", "province", "region", "category", "status", "stage",
  "next_action_on", "last_activity_on", "contacts", "checked_at"];
// Sorts that depend on the CRM overlay, rebuilt when it changes.
const CRM_SORTS = new Set(["stage", "next_action_on", "last_activity_on", "contacts"]);
const DAY_MS = 86_400_000;
export const ATTRIBUTION = "Overture Maps Foundation Places (CDLA-Permissive-2.0)";

export class LeadIndex {
  constructor(snapshot) {
    const { columns } = snapshot;
    const n = snapshot.count;
    this.snapshot = snapshot;
    this.baseVersion = snapshot.version;
    this.version = snapshot.version;
    this.n = n;
    this.columns = columns;
    this.lat = Float64Array.from(columns.lat);
    this.lon = Float64Array.from(columns.lon);
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.baseStatus = Uint8Array.from(columns.status);
    this.status = Uint8Array.from(columns.status);
    this.stage = new Uint8Array(n);
    this.category = Uint8Array.from(columns.category);
    this.phone = new Uint8Array(n);
    this.verified = new Uint8Array(n);
    this.search = new Array(n);
    const sortName = this.sortName = new Array(n);
    this.municipalities = new Map();
    for (let i = 0; i < n; i++) {
      this.xs[i] = projectX(this.lon[i]);
      this.ys[i] = projectY(this.lat[i]);
      this.phone[i] = columns.phone[i] ? 1 : 0;
      this.verified[i] = this.status[i] === VERIFIED ? 1 : 0;
      sortName[i] = normalize(columns.name[i]);
      this.search[i] = `${sortName[i]} ${normalize(columns.municipality[i])}`;
      const key = municipalityKey(columns.municipality[i], columns.province[i]);
      const box = this.municipalities.get(key);
      if (box) {
        box.count++;
        box.west = Math.min(box.west, this.lon[i]); box.east = Math.max(box.east, this.lon[i]);
        box.south = Math.min(box.south, this.lat[i]); box.north = Math.max(box.north, this.lat[i]);
      } else {
        this.municipalities.set(key, { name: columns.municipality[i], province: columns.province[i], count: 1,
          west: this.lon[i], east: this.lon[i], south: this.lat[i], north: this.lat[i] });
      }
    }
    // CRM overlay columns (online app): next action day and last activity day as day
    // numbers (0 = none), the contact count, and the row fields the table shows.
    this.nextDay = new Int32Array(n);
    this.lastDay = new Int32Array(n);
    this.contactCount = new Uint16Array(n);
    this.crm = new Map();
    this.crmStamp = "";
    this.sortCache = new Map();
    this.sortOrder();
    this.clusterCache = new Map();
    this.allClusters = this.clusters(parseFilters(new URLSearchParams()));
  }

  // List order: verified first, then by lead status, then by name.
  sortOrder() {
    const { sortName } = this;
    this.order = Int32Array.from({ length: this.n }, (_, i) => i)
      .sort((a, b) => this.status[a] - this.status[b]
        || (sortName[a] < sortName[b] ? -1 : sortName[a] > sortName[b] ? 1 : 0));
    // The table's default sort is the same order (the sort is stable, so ties keep
    // their position, as in sorted()).
    this.sortCache.set("status:asc", this.order);
  }

  indexOf(venueId) {
    if (!this.indexById) {
      this.indexById = new Map();
      for (let i = 0; i < this.n; i++) this.indexById.set(this.columns.id[i], i);
    }
    return this.indexById.get(venueId) ?? -1;
  }

  // Online CRM overlay (web/): lead statuses changed by manual decisions that the
  // laptop has not synced yet, and pipeline stages. Both are keyed by venue ID and
  // replace any previous overlay. `key` identifies the overlay: it becomes part of the
  // version, so cached tiles of another overlay are never reused.
  // Only what changed is rebuilt: the list order and the unfiltered clusters (about a
  // second on the national map) depend on statuses, not on stages.
  // `crm` maps a venue ID to { next_action, next_action_on, last_activity_on, contacts,
  // pomovi_status } (dates as YYYY-MM-DD); it feeds the table, not the map's tiles.
  applyOverlay({ status = new Map(), stage = new Map(), crm = new Map(), key = "" } = {}) {
    this.applyCrm(crm, key);
    const nextStatus = Uint8Array.from(this.baseStatus);
    const nextStage = new Uint8Array(this.n);
    for (const [venueId, code] of status) {
      const i = this.indexOf(venueId);
      const value = STATUS_CODES.indexOf(code);
      if (i >= 0 && value >= 0) nextStatus[i] = value;
    }
    for (const [venueId, code] of stage) {
      const i = this.indexOf(venueId);
      const value = STAGE_CODES.indexOf(code);
      if (i >= 0 && value > 0) nextStage[i] = value;
    }
    const statusChanged = !sameArray(nextStatus, this.status);
    if (!statusChanged && sameArray(nextStage, this.stage)) return;
    this.status.set(nextStatus);
    this.stage.set(nextStage);
    const overlaid = !sameArray(nextStatus, this.baseStatus) || nextStage.some((value) => value > 0);
    this.version = overlaid && key
      ? `${this.baseVersion}-${createHash("sha256").update(key).digest("hex").slice(0, 8)}` : this.baseVersion;
    this.metaCache = null;
    this.clusterCache = new Map();
    this.dropSorts((key) => key === "stage" || (statusChanged && key === "status"));
    if (statusChanged) {
      for (let i = 0; i < this.n; i++) this.verified[i] = this.status[i] === VERIFIED ? 1 : 0;
      this.sortOrder();
      this.allClusters = null;
      this.allClusters = this.clusters(parseFilters(new URLSearchParams()));
    }
  }

  applyCrm(crm, key) {
    const nextDay = new Int32Array(this.n);
    const lastDay = new Int32Array(this.n);
    const contactCount = new Uint16Array(this.n);
    const rows = new Map();
    for (const [venueId, row] of crm) {
      const i = this.indexOf(venueId);
      if (i < 0) continue;
      nextDay[i] = dayNumber(row.next_action_on);
      lastDay[i] = dayNumber(row.last_activity_on);
      contactCount[i] = Math.min(65_535, Math.max(0, Number(row.contacts) || 0));
      rows.set(i, row);
    }
    this.crm = rows;
    this.crmStamp = rows.size && key ? createHash("sha256").update(key).digest("hex").slice(0, 8) : "";
    if (sameArray(nextDay, this.nextDay) && sameArray(lastDay, this.lastDay)
      && sameArray(contactCount, this.contactCount)) return;
    this.nextDay.set(nextDay);
    this.lastDay.set(lastDay);
    this.contactCount.set(contactCount);
    this.dropSorts((sortKey) => CRM_SORTS.has(sortKey));
    // Filtered clusters may use the CRM filters; the unfiltered ones do not.
    this.clusterCache = new Map();
  }

  dropSorts(predicate) {
    for (const cacheKey of [...this.sortCache.keys()]) {
      if (predicate(cacheKey.split(":")[0])) this.sortCache.delete(cacheKey);
    }
  }

  meta() {
    this.metaCache ??= this.computeMeta();
    return this.metaCache;
  }

  computeMeta() {
    const regions = new Map();
    const provinces = new Map();
    const statusCounts = new Array(STATUS_CODES.length).fill(0);
    const stageCounts = new Array(STAGE_CODES.length).fill(0);
    const categoryCounts = new Array(CATEGORY_CODES.length).fill(0);
    for (let i = 0; i < this.n; i++) {
      const region = this.columns.region[i];
      const province = this.columns.province[i];
      regions.set(region, (regions.get(region) || 0) + 1);
      const provinceEntry = provinces.get(province) || { code: province, region, count: 0 };
      provinceEntry.count++;
      provinces.set(province, provinceEntry);
      statusCounts[this.status[i]]++;
      categoryCounts[this.category[i]]++;
      stageCounts[this.stage[i]]++;
    }
    return {
      version: this.version,
      built_at: this.snapshot.built_at,
      venues: this.n,
      stats: this.snapshot.stats,
      statuses: STATUSES.map((status, index) => ({ code: status.code, label: status.label, count: statusCounts[index] })),
      categories: CATEGORIES.map((category, index) => ({ code: category.code, label: category.label, count: categoryCounts[index] }))
        .filter((category) => category.count > 0),
      stages: PIPELINE_STAGES.map((stage, index) => ({ code: stage.code, label: stage.label, count: stageCounts[index + 1] })),
      regions: [...regions].filter(([code]) => code).map(([code, count]) => ({ code, name: REGIONS[code] || code, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "it")),
      provinces: [...provinces.values()].filter((province) => province.code)
        .sort((a, b) => a.code.localeCompare(b.code)),
      attribution: ATTRIBUTION,
    };
  }

  matches(i, filters) {
    return (!filters.statuses || filters.statuses.has(this.status[i]))
      && (!filters.categories || filters.categories.has(this.category[i]))
      && (!filters.region || this.columns.region[i] === filters.region)
      && (!filters.province || this.columns.province[i] === filters.province)
      && (!filters.stages || filters.stages.has(this.stage[i]))
      && (!filters.phone || this.phone[i] === 1)
      && (!filters.q || this.search[i].includes(filters.q))
      && (!filters.due || this.dueMatches(i, filters.due, filters.today))
      && (!filters.contacts || (this.contactCount[i] > 0) === (filters.contacts === "1"));
  }

  dueMatches(i, due, today) {
    const day = this.nextDay[i];
    if (due === "none") return this.stage[i] > 0 && day === 0;
    if (day === 0) return false;
    if (due === "overdue") return day < today;
    if (due === "today") return day <= today;
    if (due === "week") return day <= today + 7;
    return true;
  }

  clusters(filters) {
    if (!filters.key && this.allClusters) return this.allClusters;
    const cached = this.clusterCache.get(filters.key);
    if (cached) {
      this.clusterCache.delete(filters.key);
      this.clusterCache.set(filters.key, cached);
      return cached;
    }
    const ids = [];
    for (let i = 0; i < this.n; i++) if (this.matches(i, filters)) ids.push(i);
    const index = buildClusterIndex(this.xs, this.ys, ids, this.verified);
    if (!filters.key) return index;
    this.clusterCache.set(filters.key, index);
    if (this.clusterCache.size > CLUSTER_CACHE_SIZE) this.clusterCache.delete(this.clusterCache.keys().next().value);
    return index;
  }

  // Clusters: [px, py, count, verified, expansionZoom]; venues: [px, py, index, status].
  tile(filters, z, x, y) {
    const { clusters, venues } = tileItems(this.clusters(filters), z, x, y);
    const points = [];
    for (let k = 0; k < venues.length; k += 3) points.push(venues[k], venues[k + 1], venues[k + 2], this.status[venues[k + 2]]);
    return { v: this.version, c: clusters, p: points };
  }

  // Facet counts: each facet ignores its own filter, so the chips show how many
  // venues selecting that value would give. `matching` applies every filter.
  summary(filters, bbox) {
    const count = (withBbox) => {
      const result = { matching: 0, status: new Array(STATUS_CODES.length).fill(0),
        category: new Array(CATEGORY_CODES.length).fill(0), stage: new Array(STAGE_CODES.length).fill(0) };
      let west = 180, south = 90, east = -180, north = -90;
      const base = { ...filters, statuses: null, categories: null, stages: null };
      for (let i = 0; i < this.n; i++) {
        if (withBbox && !this.inBbox(i, bbox)) continue;
        if (!this.matches(i, base)) continue;
        const statusOk = !filters.statuses || filters.statuses.has(this.status[i]);
        const categoryOk = !filters.categories || filters.categories.has(this.category[i]);
        const stageOk = !filters.stages || filters.stages.has(this.stage[i]);
        if (categoryOk && stageOk) result.status[this.status[i]]++;
        if (statusOk && stageOk) result.category[this.category[i]]++;
        if (statusOk && categoryOk) result.stage[this.stage[i]]++;
        if (statusOk && categoryOk && stageOk) {
          result.matching++;
          west = Math.min(west, this.lon[i]); east = Math.max(east, this.lon[i]);
          south = Math.min(south, this.lat[i]); north = Math.max(north, this.lat[i]);
        }
      }
      return {
        matching: result.matching,
        bounds: result.matching ? [west, south, east, north] : null,
        status: Object.fromEntries(STATUS_CODES.map((code, index) => [code, result.status[index]])),
        category: Object.fromEntries(CATEGORY_CODES.map((code, index) => [code, result.category[index]])),
        stage: Object.fromEntries(STAGE_CODES.map((code, index) => [code, result.stage[index]])),
      };
    };
    return { v: this.version, in_view: bbox ? count(true) : null, total: count(false) };
  }

  list(filters, bbox, offset = 0, limit = 50) {
    const size = Math.max(1, Math.min(LIST_PAGE_MAX, limit));
    const items = [];
    let total = 0;
    for (const i of this.order) {
      if (bbox && !this.inBbox(i, bbox)) continue;
      if (!this.matches(i, filters)) continue;
      if (total >= offset && items.length < size) items.push(this.listItem(i));
      total++;
    }
    return { v: this.version, total, offset, items };
  }

  listItem(i) {
    const c = this.columns;
    return { i, name: c.name[i], municipality: c.municipality[i], province: c.province[i],
      category: CATEGORY_CODES[this.category[i]], status: STATUS_CODES[this.status[i]],
      stage: this.stage[i] ? STAGE_CODES[this.stage[i]] : "",
      phone: Boolean(this.phone[i]), lat: this.lat[i], lon: this.lon[i] };
  }

  // The CRM table: the rows matching `filters` in the order of `sort`, one page at a
  // time, with the total. `v` changes whenever the rows could have changed.
  table(filters, { sort = "status", dir = "asc", offset = 0, limit = 100 } = {}) {
    const key = TABLE_SORTS.includes(sort) ? sort : "status";
    const direction = dir === "desc" ? "desc" : "asc";
    const size = Math.max(1, Math.min(LIST_PAGE_MAX, limit));
    const start = Math.max(0, offset);
    const items = [];
    let total = 0;
    for (const i of this.sorted(key, direction)) {
      if (!this.matches(i, filters)) continue;
      if (total >= start && items.length < size) items.push(this.tableRow(i));
      total++;
    }
    return { v: this.tableVersion(), total, offset: start, sort: key, dir: direction, items };
  }

  tableVersion() {
    return this.crmStamp ? `${this.version}.${this.crmStamp}` : this.version;
  }

  tableRow(i) {
    const c = this.columns;
    const crm = this.crm.get(i);
    return { i, id: c.id[i], name: c.name[i], category: CATEGORY_CODES[this.category[i]],
      status: STATUS_CODES[this.status[i]], stage: this.stage[i] ? STAGE_CODES[this.stage[i]] : "",
      address: c.address[i], municipality: c.municipality[i], province: c.province[i], region: c.region[i],
      phone: c.phone[i], website: c.verified_url[i] || c.candidate_url[i], checked_at: c.checked_at[i],
      next_action: crm?.next_action ?? "", next_action_on: crm?.next_action_on ?? "",
      last_activity_on: crm?.last_activity_on ?? "", contacts: this.contactCount[i],
      pomovi_status: crm?.pomovi_status ?? "" };
  }

  // A permutation of every venue for one sort, built on first use and cached until the
  // data it depends on changes (the snapshot, the statuses, or the CRM overlay).
  sorted(key, dir) {
    const cacheKey = `${key}:${dir}`;
    const cached = this.sortCache.get(cacheKey);
    if (cached) return cached;
    const name = this.rank("name", (i) => this.sortName[i]);
    const town = () => this.rank("town", (i) => normalize(this.columns.municipality[i]));
    const province = () => this.rank("province", (i) => this.columns.province[i]);
    const region = () => this.rank("region", (i) => normalize(REGIONS[this.columns.region[i]] || ""));
    const checked = () => this.rank("checked", (i) => this.columns.checked_at[i]);
    // Each key is a list of [value, empty] columns, compared in order; name breaks ties.
    const keys = {
      name: () => [],
      municipality: () => [[town(), (i) => !this.columns.municipality[i]]],
      province: () => [[province(), (i) => !this.columns.province[i]], [town(), null]],
      region: () => [[region(), (i) => !this.columns.region[i]], [province(), null], [town(), null]],
      category: () => [[this.category, null]],
      status: () => [[this.status, null]],
      stage: () => [[this.stage, (i) => this.stage[i] === 0], [this.nextDay, (i) => this.nextDay[i] === 0]],
      next_action_on: () => [[this.nextDay, (i) => this.nextDay[i] === 0]],
      last_activity_on: () => [[this.lastDay, (i) => this.lastDay[i] === 0]],
      contacts: () => [[this.contactCount, (i) => this.contactCount[i] === 0]],
      checked_at: () => [[checked(), (i) => !this.columns.checked_at[i]]],
    }[key]();
    const sign = dir === "desc" ? -1 : 1;
    const nameSign = key === "name" ? sign : 1;
    const order = Int32Array.from({ length: this.n }, (_, i) => i).sort((a, b) => {
      for (const [values, empty] of keys) {
        if (empty) {
          const ea = empty(a), eb = empty(b);
          if (ea !== eb) return ea ? 1 : -1;
          if (ea) continue;
        }
        if (values[a] !== values[b]) return (values[a] - values[b]) * sign;
      }
      return (name[a] - name[b]) * nameSign || a - b;
    });
    this.sortCache.set(cacheKey, order);
    return order;
  }

  // Rank of each venue's value among all distinct values, so sorts compare integers.
  rank(name, valueOf) {
    this.ranks ??= new Map();
    const cached = this.ranks.get(name);
    if (cached) return cached;
    const values = Array.from({ length: this.n }, (_, i) => valueOf(i));
    const distinct = [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const position = new Map(distinct.map((value, k) => [value, k]));
    const ranks = Int32Array.from(values, (value) => position.get(value));
    this.ranks.set(name, ranks);
    return ranks;
  }

  venue(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.n) return null;
    const c = this.columns;
    return {
      ...this.listItem(i), v: this.version, id: c.id[i], region: c.region[i],
      region_name: REGIONS[c.region[i]] || c.region[i], address: c.address[i], phone: c.phone[i],
      verified_url: c.verified_url[i], candidate_url: c.candidate_url[i], menu_url: c.menu_url[i],
      assessment: c.assessment[i], failure: c.failure[i], checked_at: c.checked_at[i],
    };
  }

  locate(query, province = "") {
    const wanted = normalize(query);
    const wantedProvince = String(province || "").toUpperCase();
    let best = null;
    for (const box of this.municipalities.values()) {
      if (normalize(box.name) !== wanted) continue;
      if (wantedProvince && box.province !== wantedProvince) continue;
      if (!best || box.count > best.count) best = box;
    }
    return best;
  }

  // Search suggestions: [name, province, venue count] for every municipality, busiest
  // first, so a prefix scan on the page ranks "trev" as Treviso before Trevenzuolo.
  towns() {
    this.townsCache ??= [...this.municipalities.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "it"))
      .map((box) => [box.name, box.province, box.count]);
    return this.townsCache;
  }

  inBbox(i, [west, south, east, north]) {
    return this.lon[i] >= west && this.lon[i] <= east && this.lat[i] >= south && this.lat[i] <= north;
  }

  // Rows for CSV export: the whole selection, or a reproducible random sample
  // (the same filters, size, and seed always give the same venues).
  exportRows(filters, bbox, sampleSize = 0, seed = "") {
    let rows = [];
    for (const i of this.order) {
      if (bbox && !this.inBbox(i, bbox)) continue;
      if (this.matches(i, filters)) rows.push(i);
    }
    if (sampleSize > 0 && sampleSize < rows.length) {
      rows = rows.map((i) => [createHash("sha256").update(`${seed}\n${this.columns.id[i]}`).digest("hex"), i])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, sampleSize).map(([, i]) => i);
    }
    return rows;
  }

  csv(rows) {
    return [...this.csvChunks(rows)].join("");
  }

  // The same CSV in pieces of about `linesPerChunk` rows, so a server can stream it:
  // a whole-Italy export is ~42 MB, and Vercel refuses function responses above
  // 4.5 MB unless they are streamed.
  *csvChunks(rows, linesPerChunk = 2000) {
    const header = ["venue_id", "name", "category", "lead_status", "address", "municipality", "province",
      "region", "phone", "verified_website", "candidate_website", "crawl_state", "crawl_failure",
      "checked_at", "latitude", "longitude", "pipeline_stage", "attribution"];
    let lines = [`﻿${header.join(",")}`];
    for (const i of rows) {
      const venue = this.venue(i);
      lines.push([venue.id, venue.name, CATEGORIES[this.category[i]].label, STATUSES[this.status[i]].label,
        venue.address, venue.municipality, venue.province, venue.region_name, venue.phone,
        venue.verified_url, venue.candidate_url, venue.assessment, venue.failure, venue.checked_at,
        venue.lat, venue.lon, venue.stage, ATTRIBUTION].map(csvCell).join(","));
      if (lines.length >= linesPerChunk) {
        yield `${lines.join("\r\n")}\r\n`;
        lines = [];
      }
    }
    if (lines.length) yield `${lines.join("\r\n")}\r\n`;
  }
}

// `today` (a day number) anchors the due filters; by default, today in Italy.
export function parseFilters(params, { today = dayNumber(romeDate()) } = {}) {
  const list = (name, codes) => {
    const values = String(params.get(name) || "").split(",").map((value) => codes.indexOf(value.trim()))
      .filter((index) => index >= 0);
    return values.length && values.length < codes.length ? new Set(values) : null;
  };
  const statuses = list("status", STATUS_CODES);
  const categories = list("cat", CATEGORY_CODES);
  const stages = list("stage", STAGE_CODES);
  const region = /^\d{2}$/.test(params.get("region") || "") ? params.get("region") : "";
  const province = /^[A-Z]{2}$/.test(params.get("prov") || "") ? params.get("prov") : "";
  const phone = params.get("phone") === "1";
  const q = normalize(params.get("q") || "").slice(0, 80);
  const due = DUE_CODES.includes(params.get("due") || "") ? params.get("due") : "";
  const contacts = ["0", "1"].includes(params.get("contacts") || "") ? params.get("contacts") : "";
  const parts = [
    statuses ? [...statuses].sort().join(".") : "", categories ? [...categories].sort().join(".") : "",
    region, province, phone ? "1" : "", q, stages ? [...stages].sort().join(".") : "",
    due ? `${due}@${today}` : "", contacts,
  ];
  return { statuses, categories, stages, region, province, phone, q, due, contacts, today,
    key: parts.some(Boolean) ? parts.join("|") : "" };
}

/** Day number (days since 1970-01-01) of a YYYY-MM-DD date; 0 for none or invalid. */
export function dayNumber(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / DAY_MS);
}

/** Today's date in Italy as YYYY-MM-DD. */
export function romeDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(now);
}

export function parseBbox(value) {
  const parts = String(value || "").split(",").map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

// NFKD also folds compatibility forms, so a name typed in "bold" Unicode letters
// (𝗧𝗥𝗔𝗧𝗧𝗢𝗥𝗜𝗔) sorts and searches as plain "trattoria".
export function normalize(value) {
  return String(value || "").trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function sameArray(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return a.length === b.length;
}

function municipalityKey(name, province) { return `${normalize(name)}|${province}`; }

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
