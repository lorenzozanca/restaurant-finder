import { readFile } from "node:fs/promises";

export async function loadMunicipalityBoundaries(filePath, options = {}) {
  const document = JSON.parse(await readFile(filePath, "utf8"));
  if (document?.type !== "FeatureCollection" || !Array.isArray(document.features)) {
    throw new Error("municipality boundaries must be a GeoJSON FeatureCollection");
  }
  const regionCode = options.regionCode === undefined || options.regionCode === null
    || options.regionCode === "" ? null : normalizeCode(options.regionCode);
  const municipalities = document.features.map(normalizeMunicipality)
    .filter((feature) => !regionCode || feature.region_code === regionCode)
    .sort((left, right) => left.istat_code.localeCompare(right.istat_code));
  if (municipalities.length === 0) throw new Error(`no municipality boundaries found${regionCode ? ` for region ${regionCode}` : ""}`);
  const seen = new Set();
  for (const municipality of municipalities) {
    if (seen.has(municipality.istat_code)) throw new Error(`duplicate ISTAT municipality ${municipality.istat_code}`);
    seen.add(municipality.istat_code);
  }
  return { municipalities, metadata: document.metadata || {} };
}

export function assignMunicipality(longitude, latitude, municipalities) {
  const point = [Number(longitude), Number(latitude)];
  if (!point.every(Number.isFinite)) return { status: "invalid_geometry" };
  const matches = [];
  let touchesBoundary = false;
  const candidates = typeof municipalities?.candidates === "function"
    ? municipalities.candidates(point) : (municipalities || []);
  for (const municipality of candidates) {
    if (!insideBbox(point, municipality.bbox)) continue;
    const relation = pointInGeometry(point, municipality.geometry);
    if (relation === "boundary") touchesBoundary = true;
    if (relation !== "outside") matches.push(municipality);
  }
  if (matches.length === 1 && !touchesBoundary) return { status: "assigned", municipality: matches[0] };
  if (matches.length === 0) return { status: "outside_region" };
  return { status: "boundary_ambiguous", candidates: matches.map(publicMunicipality) };
}

export function createMunicipalityIndex(municipalities, options = {}) {
  const cellSize = Number(options.cellSize ?? 0.1);
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new TypeError("boundary index cellSize must be positive");
  }
  const cells = new Map();
  for (const municipality of municipalities || []) {
    const minX = Math.floor(municipality.bbox[0] / cellSize);
    const minY = Math.floor(municipality.bbox[1] / cellSize);
    const maxX = Math.floor(municipality.bbox[2] / cellSize);
    const maxY = Math.floor(municipality.bbox[3] / cellSize);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const key = `${x}:${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(municipality);
    }
  }
  return {
    cell_size: cellSize,
    candidates([longitude, latitude]) {
      const key = `${Math.floor(longitude / cellSize)}:${Math.floor(latitude / cellSize)}`;
      return cells.get(key) || [];
    },
  };
}

export function pointInGeometry(point, geometry) {
  if (geometry?.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry?.type === "MultiPolygon") {
    let inside = false;
    let boundaries = 0;
    for (const polygon of geometry.coordinates || []) {
      const relation = pointInPolygon(point, polygon);
      if (relation === "boundary") boundaries++;
      if (relation === "inside") inside = true;
    }
    if (boundaries >= 2) return "inside";
    if (boundaries === 1) return "boundary";
    return inside ? "inside" : "outside";
  }
  return "outside";
}

function pointInPolygon(point, rings) {
  if (!Array.isArray(rings) || rings.length === 0) return "outside";
  const outer = pointInRing(point, rings[0]);
  if (outer !== "inside") return outer;
  for (const hole of rings.slice(1)) {
    const relation = pointInRing(point, hole);
    if (relation === "boundary") return "boundary";
    if (relation === "inside") return "outside";
  }
  return "inside";
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[previous];
    const [x2, y2] = ring[current];
    if (pointOnSegment(x, y, x1, y1, x2, y2)) return "boundary";
    const crosses = ((y1 > y) !== (y2 > y))
      && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1;
    if (crosses) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function pointOnSegment(x, y, x1, y1, x2, y2) {
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  const scale = Math.max(1, Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2));
  if (Math.abs(cross) > 1e-11 * scale) return false;
  return x >= Math.min(x1, x2) - 1e-11 && x <= Math.max(x1, x2) + 1e-11
    && y >= Math.min(y1, y2) - 1e-11 && y <= Math.max(y1, y2) + 1e-11;
}

function normalizeMunicipality(feature) {
  const properties = feature?.properties || {};
  const geometry = feature?.geometry;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error("municipality boundary has unsupported geometry");
  }
  const municipality = {
    istat_code: normalizeCode(properties.istat_code || properties.PRO_COM || properties.pro_com),
    municipality: clean(properties.municipality || properties.COMUNE || properties.comune),
    province_code: clean(properties.province_code || properties.SIGLA || properties.sigla).toUpperCase(),
    province: clean(properties.province || properties.PROVINCIA || properties.provincia),
    region_code: normalizeCode(properties.region_code || properties.COD_REG || properties.cod_reg),
    region: clean(properties.region || properties.REGIONE || properties.regione),
    geometry,
    bbox: geometryBbox(geometry),
  };
  if (!/^\d{6}$/.test(municipality.istat_code) || !municipality.municipality
      || !/^\d{2}$/.test(municipality.region_code)) {
    throw new Error("municipality boundary is missing its ISTAT identity fields");
  }
  return municipality;
}

function geometryBbox(geometry) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry.coordinates, (coordinate) => {
    bbox[0] = Math.min(bbox[0], coordinate[0]);
    bbox[1] = Math.min(bbox[1], coordinate[1]);
    bbox[2] = Math.max(bbox[2], coordinate[0]);
    bbox[3] = Math.max(bbox[3], coordinate[1]);
  });
  if (!bbox.every(Number.isFinite)) throw new Error("municipality boundary has invalid coordinates");
  return bbox;
}

function visitCoordinates(value, visitor) {
  if (Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)) {
    visitor(value);
    return;
  }
  for (const child of value || []) visitCoordinates(child, visitor);
}

function insideBbox([x, y], bbox) {
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}
function publicMunicipality(value) {
  return { istat_code: value.istat_code, municipality: value.municipality,
    province_code: value.province_code, region_code: value.region_code };
}
function normalizeCode(value) { return clean(value).padStart(2, "0"); }
function clean(value) { return String(value ?? "").trim(); }
