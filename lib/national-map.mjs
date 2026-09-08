import { DatabaseSync } from "node:sqlite";
import { registrableDomain } from "./publisher-ownership.mjs";

const VALID_STATUSES = new Set(["all", "candidate", "verified", "rejected", "no_candidate"]);

export function loadNationalVenueIndex(databasePath, options = {}) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const at = String(options.at || new Date().toISOString());
  try {
    const venueRows = db.prepare(`SELECT venue_id, display_name, municipality FROM venues
      WHERE lifecycle_status = 'active' ORDER BY venue_id`).all();
    const sourceByVenue = new Map();
    for (const row of db.prepare(`SELECT venue_id, payload_json FROM source_records
        ORDER BY venue_id, source_record_id`).iterate()) {
      const source = parseJson(row.payload_json);
      const prior = sourceByVenue.get(row.venue_id);
      // Duplicate source records are rare. Prefer the record carrying a candidate URL
      // so every one of the inventory's 86,852 candidate venues is represented.
      if (!prior || (!clean(prior.website) && clean(source.website))) {
        sourceByVenue.set(row.venue_id, source);
      }
    }

    const attestations = db.prepare(`SELECT venue_id, publisher_domain, decision_status
      FROM publisher_attestations
      WHERE lifecycle_status = 'active' AND reviewed_at <= ? AND expires_at > ?`).all(at, at);
    const verifiedPublishers = new Set();
    const rejectedPublishers = new Set();
    for (const row of attestations) {
      const key = `${row.venue_id}\n${row.publisher_domain}`;
      (row.decision_status === "verified" ? verifiedPublishers : rejectedPublishers).add(key);
    }

    const verifiedByVenue = new Map();
    for (const row of db.prepare(`SELECT venue_id, fact_key, payload_json FROM facts
        WHERE kind = 'website' AND decision_status = 'accepted' AND lifecycle_status = 'active'
        ORDER BY fact_id`).all()) {
      const domain = registrableDomain(row.fact_key);
      if (verifiedPublishers.has(`${row.venue_id}\n${domain}`)) {
        verifiedByVenue.set(row.venue_id, { url: row.fact_key, payload: parseJson(row.payload_json) });
      }
    }

    const assessmentsByCandidate = new Map();
    const assessmentCounts = {
      strongly_correlated: 0, ambiguous: 0, contradicted: 0, retryable: 0,
      unsupported_publisher: 0,
    };
    if (tableExists(db, "candidate_assessments")) {
      for (const row of db.prepare(`SELECT venue_id, candidate_url, final_url,
          assessment_state, crawl_outcome, identity_score, geography_score,
          officialness_score, evidence_json, checked_at
        FROM candidate_assessments ORDER BY assessment_id`).all()) {
        assessmentCounts[row.assessment_state] = (assessmentCounts[row.assessment_state] || 0) + 1;
        assessmentsByCandidate.set(`${row.venue_id}\n${canonicalUrl(row.candidate_url)}`, {
          state: row.assessment_state,
          crawl_outcome: row.crawl_outcome,
          final_url: row.final_url,
          scores: {
            identity: row.identity_score,
            geography: row.geography_score,
            officialness: row.officialness_score,
          },
          evidence: parseJson(row.evidence_json),
          checked_at: row.checked_at,
        });
      }
    }

    const menuByVenue = new Map();
    for (const row of db.prepare(`SELECT venue_id, fact_key, payload_json FROM facts
        WHERE kind = 'resource' AND decision_status = 'accepted' AND lifecycle_status = 'active'
        ORDER BY fact_id`).all()) {
      const payload = parseJson(row.payload_json);
      const prior = menuByVenue.get(row.venue_id);
      if (!prior || (payload.role === "menu" && prior.role !== "menu")) {
        menuByVenue.set(row.venue_id, { url: row.fact_key, role: payload.role || "resource" });
      }
    }

    const venues = [];
    const stats = { venues: 0, source_candidates: 0, verified: 0, rejected: 0, no_candidate: 0,
      assessed: Object.values(assessmentCounts).reduce((sum, count) => sum + count, 0),
      assessments: assessmentCounts };
    for (const row of venueRows) {
      const source = sourceByVenue.get(row.venue_id) || {};
      const latitude = Number(source.latitude);
      const longitude = Number(source.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const candidateUrl = clean(source.website);
      const candidateDomain = registrableDomain(candidateUrl);
      const candidateAssessment = assessmentsByCandidate.get(
        `${row.venue_id}\n${canonicalUrl(candidateUrl)}`) || null;
      const verified = verifiedByVenue.get(row.venue_id);
      const candidateRejected = Boolean(candidateDomain
        && rejectedPublishers.has(`${row.venue_id}\n${candidateDomain}`));
      const status = verified ? "verified" : candidateRejected ? "rejected"
        : candidateUrl ? "candidate" : "no_candidate";
      const menu = verified ? menuByVenue.get(row.venue_id) : null;
      venues.push({
        id: row.venue_id,
        name: row.display_name,
        municipality: clean(source.municipality) || row.municipality,
        province: clean(source.province_code),
        region: clean(source.region_code),
        type: clean(source.type),
        address: clean(source.address),
        phone: clean(source.phone),
        latitude,
        longitude,
        candidate_url: candidateUrl,
        candidate_assessment: candidateAssessment,
        verified_url: verified?.url || "",
        menu_url: menu?.url || "",
        status,
        search: normalize(`${row.display_name} ${source.municipality || row.municipality} ${source.province_code || ""}`),
      });
      stats.venues++;
      if (candidateUrl) stats.source_candidates++;
      else stats.no_candidate++;
      if (verified) stats.verified++;
      if (candidateRejected) stats.rejected++;
    }
    return { venues, stats, generated_at: at };
  } finally {
    db.close();
  }
}

export function queryNationalVenueIndex(index, options = {}) {
  const status = VALID_STATUSES.has(options.status) ? options.status : "all";
  const zoom = finite(options.zoom, 6);
  const bbox = parseBbox(options.bbox);
  const query = normalize(options.query || "");
  const province = normalize(options.province || "");
  const limit = Math.max(1, Math.min(20_000, finite(options.limit, 12_000)));
  let rows = index.venues.filter((venue) => statusMatches(venue, status));
  if (query) {
    const exactMunicipality = rows.filter((venue) => normalize(venue.municipality) === query
      && (!province || normalize(venue.province) === province));
    rows = exactMunicipality.length ? exactMunicipality
      : rows.filter((venue) => venue.search.includes(query)
        && (!province || normalize(venue.province) === province));
  } else if (bbox) {
    rows = rows.filter((venue) => inBbox(venue, bbox));
  }

  const showVenues = Boolean(query) || zoom >= 10 || status === "verified" || status === "rejected";
  if (showVenues && rows.length <= limit) {
    return response(index, "venues", rows.length, rows.map(venueFeature));
  }
  return response(index, "clusters", rows.length, clusterFeatures(rows, gridSize(zoom)));
}

function response(index, mode, visibleCount, features) {
  return {
    type: "FeatureCollection",
    generated_at: index.generated_at,
    mode,
    visible_count: visibleCount,
    stats: index.stats,
    features,
  };
}

function venueFeature(venue) {
  const { latitude, longitude, search: _search, ...properties } = venue;
  return { type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] }, properties };
}

function clusterFeatures(rows, size) {
  const cells = new Map();
  for (const venue of rows) {
    const x = Math.floor(venue.longitude / size);
    const y = Math.floor(venue.latitude / size);
    const key = `${x}:${y}`;
    const cell = cells.get(key) || {
      latitude: 0, longitude: 0, count: 0, candidate: 0, verified: 0, rejected: 0, no_candidate: 0,
    };
    cell.latitude += venue.latitude;
    cell.longitude += venue.longitude;
    cell.count++;
    if (venue.candidate_url) cell.candidate++;
    if (venue.status === "verified") cell.verified++;
    if (venue.status === "rejected") cell.rejected++;
    if (!venue.candidate_url) cell.no_candidate++;
    cells.set(key, cell);
  }
  return [...cells.values()].map((cell) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [cell.longitude / cell.count, cell.latitude / cell.count] },
    properties: { kind: "cluster", ...cell, latitude: undefined, longitude: undefined },
  }));
}

function statusMatches(venue, status) {
  if (status === "all") return true;
  if (status === "candidate") return Boolean(venue.candidate_url);
  if (status === "no_candidate") return !venue.candidate_url;
  return venue.status === status;
}

function parseBbox(value) {
  const parts = String(value || "").split(",").map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

function inBbox(venue, [west, south, east, north]) {
  return venue.longitude >= west && venue.longitude <= east
    && venue.latitude >= south && venue.latitude <= north;
}

function gridSize(zoom) {
  if (zoom <= 5) return 0.5;
  if (zoom === 6) return 0.25;
  if (zoom === 7) return 0.12;
  if (zoom === 8) return 0.06;
  return 0.03;
}

function normalize(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function clean(value) { return String(value || "").trim(); }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function parseJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function canonicalUrl(value) {
  try { return new URL(clean(value)).href; } catch { return ""; }
}
function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}
