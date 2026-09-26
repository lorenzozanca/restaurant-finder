import { createHash } from "node:crypto";
import { buildClusterIndex, projectX, projectY, tileItems } from "./map-cluster.mjs";
import { CATEGORIES, REGIONS, STATUSES } from "./map-snapshot.mjs";

// In-memory query layer over a map snapshot: filters, cached cluster indexes,
// tiles, facet counts, the venue list, details, and CSV export. Everything is a
// scan over typed arrays or a lookup in a prebuilt cluster index; nothing touches
// SQLite.

const CLUSTER_CACHE_SIZE = 12;
const STATUS_CODES = STATUSES.map((status) => status.code);
const CATEGORY_CODES = CATEGORIES.map((category) => category.code);
const VERIFIED = STATUS_CODES.indexOf("verified");
export const LIST_PAGE_MAX = 200;
export const ATTRIBUTION = "Overture Maps Foundation Places (CDLA-Permissive-2.0)";

export class LeadIndex {
  constructor(snapshot) {
    const { columns } = snapshot;
    const n = snapshot.count;
    this.snapshot = snapshot;
    this.version = snapshot.version;
    this.n = n;
    this.columns = columns;
    this.lat = Float64Array.from(columns.lat);
    this.lon = Float64Array.from(columns.lon);
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.status = Uint8Array.from(columns.status);
    this.category = Uint8Array.from(columns.category);
    this.phone = new Uint8Array(n);
    this.verified = new Uint8Array(n);
    this.search = new Array(n);
    const sortName = new Array(n);
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
    // List order: verified first, then by lead status, then by name.
    this.order = Int32Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => this.status[a] - this.status[b]
        || (sortName[a] < sortName[b] ? -1 : sortName[a] > sortName[b] ? 1 : 0));
    this.clusterCache = new Map();
    this.allClusters = this.clusters(parseFilters(new URLSearchParams()));
  }

  meta() {
    this.metaCache ??= this.computeMeta();
    return this.metaCache;
  }

  computeMeta() {
    const regions = new Map();
    const provinces = new Map();
    const statusCounts = new Array(STATUS_CODES.length).fill(0);
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
    }
    return {
      version: this.version,
      built_at: this.snapshot.built_at,
      venues: this.n,
      stats: this.snapshot.stats,
      statuses: STATUSES.map((status, index) => ({ code: status.code, label: status.label, count: statusCounts[index] })),
      categories: CATEGORIES.map((category, index) => ({ code: category.code, label: category.label, count: categoryCounts[index] }))
        .filter((category) => category.count > 0),
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
      && (!filters.phone || this.phone[i] === 1)
      && (!filters.q || this.search[i].includes(filters.q));
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
        category: new Array(CATEGORY_CODES.length).fill(0) };
      let west = 180, south = 90, east = -180, north = -90;
      const base = { ...filters, statuses: null, categories: null };
      for (let i = 0; i < this.n; i++) {
        if (withBbox && !this.inBbox(i, bbox)) continue;
        if (!this.matches(i, base)) continue;
        const statusOk = !filters.statuses || filters.statuses.has(this.status[i]);
        const categoryOk = !filters.categories || filters.categories.has(this.category[i]);
        if (categoryOk) result.status[this.status[i]]++;
        if (statusOk) result.category[this.category[i]]++;
        if (statusOk && categoryOk) {
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
      phone: Boolean(this.phone[i]), lat: this.lat[i], lon: this.lon[i] };
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
    const header = ["venue_id", "name", "category", "lead_status", "address", "municipality", "province",
      "region", "phone", "verified_website", "candidate_website", "crawl_state", "crawl_failure",
      "checked_at", "latitude", "longitude", "attribution"];
    const lines = [header.join(",")];
    for (const i of rows) {
      const venue = this.venue(i);
      lines.push([venue.id, venue.name, CATEGORIES[this.category[i]].label, STATUSES[this.status[i]].label,
        venue.address, venue.municipality, venue.province, venue.region_name, venue.phone,
        venue.verified_url, venue.candidate_url, venue.assessment, venue.failure, venue.checked_at,
        venue.lat, venue.lon, ATTRIBUTION].map(csvCell).join(","));
    }
    return `﻿${lines.join("\r\n")}\r\n`;
  }
}

export function parseFilters(params) {
  const list = (name, codes) => {
    const values = String(params.get(name) || "").split(",").map((value) => codes.indexOf(value.trim()))
      .filter((index) => index >= 0);
    return values.length && values.length < codes.length ? new Set(values) : null;
  };
  const statuses = list("status", STATUS_CODES);
  const categories = list("cat", CATEGORY_CODES);
  const region = /^\d{2}$/.test(params.get("region") || "") ? params.get("region") : "";
  const province = /^[A-Z]{2}$/.test(params.get("prov") || "") ? params.get("prov") : "";
  const phone = params.get("phone") === "1";
  const q = normalize(params.get("q") || "").slice(0, 80);
  const key = [
    statuses ? [...statuses].sort().join(".") : "", categories ? [...categories].sort().join(".") : "",
    region, province, phone ? "1" : "", q,
  ].join("|");
  return { statuses, categories, region, province, phone, q, key: key === "|||||" ? "" : key };
}

export function parseBbox(value) {
  const parts = String(value || "").split(",").map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

export function normalize(value) {
  return String(value || "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function municipalityKey(name, province) { return `${normalize(name)}|${province}`; }

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
