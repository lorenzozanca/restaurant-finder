import { DatabaseSync } from "node:sqlite";
import { registrableDomain } from "./publisher-ownership.mjs";

const VALID_STATUSES = new Set(["all", "candidate", "verified", "rejected", "no_candidate"]);

// Hierarchical zoom levels: low zoom shows few large admin areas, drilling down
// as the operator zooms. This keeps Italy-wide payloads tiny (20 regions) and
// avoids the previous single grid level that emitted ~19k DOM clusters.
const MAX_CLUSTER_FEATURES = 2500;
const DEFAULT_VENUE_LIMIT = 2000;
const MAX_VENUE_LIMIT = 5000;

const REGION_NAMES = {
  "01": "Piemonte", "02": "Valle d'Aosta", "03": "Lombardia",
  "04": "Trentino-Alto Adige", "05": "Veneto", "06": "Friuli-Venezia Giulia",
  "07": "Liguria", "08": "Emilia-Romagna", "09": "Toscana", "10": "Umbria",
  "11": "Marche", "12": "Lazio", "13": "Abruzzo", "14": "Molise",
  "15": "Campania", "16": "Puglia", "17": "Basilicata", "18": "Calabria",
  "19": "Sicilia", "20": "Sardegna",
};

const PROVINCE_NAMES = {"AG":"Agrigento","AL":"Alessandria","AN":"Ancona","AR":"Arezzo","AP":"Ascoli Piceno","AT":"Asti","AV":"Avellino","BA":"Bari","BT":"Barletta-Andria-Trani","BL":"Belluno","BN":"Benevento","BG":"Bergamo","BI":"Biella","BO":"Bologna","BZ":"Bolzano/Bozen","BS":"Brescia","BR":"Brindisi","CA":"Cagliari","CL":"Caltanissetta","CB":"Campobasso","CE":"Caserta","CT":"Catania","CZ":"Catanzaro","CH":"Chieti","CO":"Como","CS":"Cosenza","CR":"Cremona","KR":"Crotone","CN":"Cuneo","EN":"Enna","FM":"Fermo","FE":"Ferrara","FI":"Firenze","FG":"Foggia","FC":"Forlì-Cesena","FR":"Frosinone","OT":"Gallura Nord-Est Sardegna","GE":"Genova","GO":"Gorizia","GR":"Grosseto","IM":"Imperia","IS":"Isernia","AQ":"L'Aquila","SP":"La Spezia","LT":"Latina","LE":"Lecce","LC":"Lecco","LI":"Livorno","LO":"Lodi","LU":"Lucca","MC":"Macerata","MN":"Mantova","MS":"Massa-Carrara","MT":"Matera","VS":"Medio Campidano","ME":"Messina","MI":"Milano","MO":"Modena","MB":"Monza e della Brianza","NA":"Napoli","NO":"Novara","NU":"Nuoro","OG":"Ogliastra","OR":"Oristano","PD":"Padova","PA":"Palermo","PR":"Parma","PV":"Pavia","PG":"Perugia","PU":"Pesaro e Urbino","PE":"Pescara","PC":"Piacenza","PI":"Pisa","PT":"Pistoia","PN":"Pordenone","PZ":"Potenza","PO":"Prato","RG":"Ragusa","RA":"Ravenna","RC":"Reggio Calabria","RE":"Reggio nell'Emilia","RI":"Rieti","RN":"Rimini","RM":"Roma","RO":"Rovigo","SA":"Salerno","SS":"Sassari","SV":"Savona","SI":"Siena","SR":"Siracusa","SO":"Sondrio","SU":"Sulcis Iglesiente","TA":"Taranto","TE":"Teramo","TR":"Terni","TO":"Torino","TP":"Trapani","TN":"Trento","TV":"Treviso","TS":"Trieste","UD":"Udine","AO":"Valle d'Aosta","VA":"Varese","VE":"Venezia","VB":"Verbano-Cusio-Ossola","VC":"Vercelli","VR":"Verona","VV":"Vibo Valentia","VI":"Vicenza","VT":"Viterbo"};

export function loadNationalVenueIndex(databasePath, options = {}) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const at = String(options.at || new Date().toISOString());
  try {
    const venueRows = db.prepare(`SELECT venue_id, display_name, municipality FROM venues
      WHERE lifecycle_status = 'active' ORDER BY venue_id`).all();
    const sourceByVenue = new Map();
    // Only the display/coordinate/website columns are extracted in SQL. The raw
    // payload blobs also carry a large provenance section (~4KB/row, ~600MB
    // total); parsing them in JS made startup take ~10s. json_extract avoids
    // that parse. Duplicate records are rare; the pass below prefers the
    // record carrying a candidate URL so all 86,852 candidate venues stay
    // represented.
    for (const row of db.prepare(`SELECT venue_id,
          json_extract(payload_json,'$.municipality') AS municipality,
          json_extract(payload_json,'$.province_code') AS province_code,
          json_extract(payload_json,'$.region_code') AS region_code,
          json_extract(payload_json,'$.type') AS type,
          json_extract(payload_json,'$.address') AS address,
          json_extract(payload_json,'$.phone') AS phone,
          json_extract(payload_json,'$.latitude') AS latitude,
          json_extract(payload_json,'$.longitude') AS longitude,
          json_extract(payload_json,'$.website') AS website
        FROM source_records`).iterate()) {
      const prior = sourceByVenue.get(row.venue_id);
      if (!prior) {
        sourceByVenue.set(row.venue_id, {
          municipality: row.municipality,
          province_code: row.province_code,
          region_code: row.region_code,
          type: row.type,
          address: row.address,
          phone: row.phone,
          latitude: row.latitude,
          longitude: row.longitude,
          website: row.website,
        });
      } else if (!clean(prior.website) && clean(row.website)) {
        prior.municipality = row.municipality;
        prior.province_code = row.province_code;
        prior.region_code = row.region_code;
        prior.type = row.type;
        prior.address = row.address;
        prior.phone = row.phone;
        prior.latitude = row.latitude;
        prior.longitude = row.longitude;
        prior.website = row.website;
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
  const limit = Math.max(1, Math.min(MAX_VENUE_LIMIT, finite(options.limit, DEFAULT_VENUE_LIMIT)));
  let rows = index.venues.filter((venue) => statusMatches(venue, status));
  if (query) {
    const exactMunicipality = rows.filter((venue) => normalize(venue.municipality) === query
      && (!province || normalize(venue.province) === province));
    rows = exactMunicipality.length ? exactMunicipality
      : rows.filter((venue) => venue.search.includes(query)
        && (!province || normalize(venue.province) === province));
    return response(index, "venues", rows.length, rows.slice(0, limit).map(venueFeature), {
      group_level: null,
      truncated: rows.length > limit,
    });
  }
  if (bbox) {
    rows = rows.filter((venue) => inBbox(venue, bbox));
  }

  // Verified/rejected sets are tiny (112 + a handful); always show venues.
  if ((status === "verified" || status === "rejected") && rows.length <= limit) {
    return response(index, "venues", rows.length, rows.map(venueFeature), {
      group_level: null,
      truncated: false,
    });
  }

  if (zoom <= 6) {
    return response(index, "clusters", rows.length, adminClusterFeatures(rows, "region"), { group_level: "region" });
  }
  if (zoom <= 8) {
    return response(index, "clusters", rows.length, adminClusterFeatures(rows, "province"), { group_level: "province" });
  }
  if (zoom <= 10) {
    const municipalities = adminClusterFeatures(rows, "municipality");
    // Whole-Italy viewports at z9-10 would otherwise emit up to 7,398 town
    // clusters. Fall back to provinces when the town level is too dense.
    if (municipalities.length > MAX_CLUSTER_FEATURES) {
      return response(index, "clusters", rows.length, adminClusterFeatures(rows, "province"), { group_level: "province" });
    }
    return response(index, "clusters", rows.length, municipalities, { group_level: "municipality" });
  }
  if (rows.length <= limit) {
    return response(index, "venues", rows.length, rows.map(venueFeature), {
      group_level: null,
      truncated: false,
    });
  }
  return response(index, "clusters", rows.length, gridClusterFeatures(rows, gridSize(zoom)), { group_level: "grid" });
}

function response(index, mode, visibleCount, features, extra = {}) {
  return {
    type: "FeatureCollection",
    generated_at: index.generated_at,
    mode,
    group_level: extra.group_level ?? null,
    truncated: extra.truncated ?? false,
    visible_count: visibleCount,
    stats: index.stats,
    features,
  };
}

function venueFeature(venue) {
  const { latitude, longitude, search: _search, ...properties } = venue;
  return { type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] }, properties };
}

function adminClusterFeatures(rows, level) {
  const groups = new Map();
  for (const venue of rows) {
    let key;
    let code;
    let label;
    if (level === "region") {
      code = clean(venue.region) || "unknown";
      key = code;
      label = REGION_NAMES[code] || (code === "unknown" ? "Unknown region" : `Region ${code}`);
    } else if (level === "province") {
      code = clean(venue.province) || "unknown";
      key = code;
      label = code === "unknown" ? "Unknown province"
        : PROVINCE_NAMES[code] ? `${PROVINCE_NAMES[code]} (${code})` : code;
    } else {
      const muniNorm = normalize(venue.municipality) || "unknown";
      code = `${clean(venue.province) || "unknown"}|${venue.municipality || "unknown"}`;
      key = `${clean(venue.province) || "unknown"}\n${muniNorm}`;
      const display = clean(venue.municipality) || "Unknown town";
      label = clean(venue.province) ? `${display} (${clean(venue.province)})` : display;
    }
    let group = groups.get(key);
    if (!group) {
      group = {
        code, label, latitude: 0, longitude: 0, count: 0,
        candidate: 0, verified: 0, rejected: 0, no_candidate: 0,
        west: Infinity, south: Infinity, east: -Infinity, north: -Infinity,
      };
      groups.set(key, group);
    }
    group.latitude += venue.latitude;
    group.longitude += venue.longitude;
    group.count++;
    if (venue.candidate_url) group.candidate++;
    else group.no_candidate++;
    if (venue.status === "verified") group.verified++;
    if (venue.status === "rejected") group.rejected++;
    if (venue.longitude < group.west) group.west = venue.longitude;
    if (venue.longitude > group.east) group.east = venue.longitude;
    if (venue.latitude < group.south) group.south = venue.latitude;
    if (venue.latitude > group.north) group.north = venue.latitude;
  }
  return [...groups.values()].map((group) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [group.longitude / group.count, group.latitude / group.count],
    },
    properties: {
      kind: "cluster",
      level,
      code: group.code,
      label: group.label,
      count: group.count,
      candidate: group.candidate,
      verified: group.verified,
      rejected: group.rejected,
      no_candidate: group.no_candidate,
      bounds: [group.west, group.south, group.east, group.north],
    },
  }));
}

function gridClusterFeatures(rows, size) {
  let cellSize = size;
  let cells = new Map();
  // Adapt the cell size so a pathological viewport (e.g. whole Italy at z11
  // in a test) can never emit tens of thousands of DOM markers.
  for (let attempt = 0; attempt < 6; attempt++) {
    cells = new Map();
    for (const venue of rows) {
      const x = Math.floor(venue.longitude / cellSize);
      const y = Math.floor(venue.latitude / cellSize);
      const key = `${x}:${y}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = {
          latitude: 0, longitude: 0, count: 0, candidate: 0, verified: 0,
          rejected: 0, no_candidate: 0,
          west: x * cellSize, south: y * cellSize,
          east: (x + 1) * cellSize, north: (y + 1) * cellSize,
        };
        cells.set(key, cell);
      }
      cell.latitude += venue.latitude;
      cell.longitude += venue.longitude;
      cell.count++;
      if (venue.candidate_url) cell.candidate++;
      else cell.no_candidate++;
      if (venue.status === "verified") cell.verified++;
      if (venue.status === "rejected") cell.rejected++;
    }
    if (cells.size <= MAX_CLUSTER_FEATURES || cellSize >= 2) break;
    cellSize *= 2;
  }
  return [...cells.values()].map((cell) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [cell.longitude / cell.count, cell.latitude / cell.count] },
    properties: {
      kind: "cluster", level: "grid", code: "", label: "",
      count: cell.count, candidate: cell.candidate, verified: cell.verified,
      rejected: cell.rejected, no_candidate: cell.no_candidate,
      bounds: [cell.west, cell.south, cell.east, cell.north],
    },
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
  if (zoom <= 11) return 0.06;
  if (zoom === 12) return 0.03;
  if (zoom === 13) return 0.015;
  return 0.008;
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
