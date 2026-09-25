// Screen-space clustering for the national lead map (supercluster-style).
//
// Points are projected to Web Mercator [0, 1] once. For every zoom level from
// MAX_CLUSTER_ZOOM down to MIN_CLUSTER_ZOOM, items of the level below that lie
// within RADIUS_PX screen pixels of each other merge into one cluster placed at
// their weighted centroid. Levels are anchored to the world, not the viewport, so
// clusters never jump while panning, and every cluster records the zoom at which
// it splits (its expansion zoom). Above MAX_CLUSTER_ZOOM individual venues are
// shown. Every level is bucketed by map tile so a tile query touches only a few
// buckets.

export const MIN_CLUSTER_ZOOM = 4;
export const MAX_CLUSTER_ZOOM = 16;
export const RADIUS_PX = 60;
export const TILE_PX = 512;
// Items within this many pixels outside a tile are returned with it, so a bubble
// straddling a tile edge is drawn in full by both neighbours.
export const TILE_BUFFER_PX = 48;
const WORLD_PX = 256;

export function projectX(longitude) { return longitude / 360 + 0.5; }
export function projectY(latitude) {
  const sin = Math.sin(latitude * Math.PI / 180);
  const y = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

// xs, ys: projected coordinates of every snapshot venue. ids: the snapshot
// indices to cluster (a filtered subset). flags: 1 for venues counted in the
// cluster's highlight share (verified websites), 0 otherwise.
export function buildClusterIndex(xs, ys, ids, flags) {
  const levels = new Array(MAX_CLUSTER_ZOOM + 2);
  const n = ids.length;
  let current = {
    x: new Float64Array(n), y: new Float64Array(n), count: new Uint32Array(n),
    flagged: new Uint32Array(n), expand: new Uint8Array(n), id: new Int32Array(n), size: n,
  };
  for (let i = 0; i < n; i++) {
    const venue = ids[i];
    current.x[i] = xs[venue];
    current.y[i] = ys[venue];
    current.count[i] = 1;
    current.flagged[i] = flags[venue];
    current.expand[i] = MAX_CLUSTER_ZOOM + 1;
    current.id[i] = venue;
  }
  levels[MAX_CLUSTER_ZOOM + 1] = bucketed(current, MAX_CLUSTER_ZOOM + 1);
  for (let zoom = MAX_CLUSTER_ZOOM; zoom >= MIN_CLUSTER_ZOOM; zoom--) {
    current = clusterLevel(current, zoom);
    levels[zoom] = bucketed(current, zoom);
  }
  return { levels, total: n };
}

function clusterLevel(previous, zoom) {
  const radius = RADIUS_PX / (WORLD_PX * 2 ** zoom);
  const size = previous.size;
  const cells = new Map();
  for (let i = 0; i < size; i++) {
    const key = cellKey(Math.floor(previous.x[i] / radius), Math.floor(previous.y[i] / radius));
    const bucket = cells.get(key);
    if (bucket) bucket.push(i); else cells.set(key, [i]);
  }
  const next = {
    x: new Float64Array(size), y: new Float64Array(size), count: new Uint32Array(size),
    flagged: new Uint32Array(size), expand: new Uint8Array(size), id: new Int32Array(size), size: 0,
  };
  const visited = new Uint8Array(size);
  const radius2 = radius * radius;
  for (let i = 0; i < size; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const x = previous.x[i];
    const y = previous.y[i];
    const cx = Math.floor(x / radius);
    const cy = Math.floor(y / radius);
    let count = previous.count[i];
    let flagged = previous.flagged[i];
    let sumX = x * count;
    let sumY = y * count;
    let merged = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get(cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (visited[j]) continue;
          const ddx = previous.x[j] - x;
          const ddy = previous.y[j] - y;
          if (ddx * ddx + ddy * ddy > radius2) continue;
          visited[j] = 1;
          const weight = previous.count[j];
          count += weight;
          flagged += previous.flagged[j];
          sumX += previous.x[j] * weight;
          sumY += previous.y[j] * weight;
          merged++;
        }
      }
    }
    const k = next.size++;
    if (merged) {
      next.x[k] = sumX / count;
      next.y[k] = sumY / count;
      next.count[k] = count;
      next.flagged[k] = flagged;
      next.expand[k] = zoom + 1;
      next.id[k] = -1;
    } else {
      next.x[k] = x;
      next.y[k] = y;
      next.count[k] = count;
      next.flagged[k] = flagged;
      next.expand[k] = previous.expand[i];
      next.id[k] = previous.id[i];
    }
  }
  return next;
}

function cellKey(cx, cy) { return cx * 4194304 + cy; }

function bucketed(level, zoom) {
  const tiles = 2 ** zoom * WORLD_PX / TILE_PX;
  const buckets = new Map();
  for (let i = 0; i < level.size; i++) {
    const key = cellKey(Math.min(tiles - 1, Math.floor(level.x[i] * tiles)),
      Math.min(tiles - 1, Math.floor(level.y[i] * tiles)));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i); else buckets.set(key, [i]);
  }
  return { ...level, zoom, tiles, buckets };
}

// Items for one TILE_PX map tile at map zoom z, with tile-local pixel positions.
// Clusters: [px, py, count, flagged, expansionZoom]; venues: [px, py, venueIndex].
export function tileItems(index, z, x, y) {
  const levelZoom = Math.max(MIN_CLUSTER_ZOOM, Math.min(MAX_CLUSTER_ZOOM + 1, z));
  const level = index.levels[levelZoom];
  const worldPx = WORLD_PX * 2 ** z;
  const left = (x * TILE_PX - TILE_BUFFER_PX) / worldPx;
  const right = ((x + 1) * TILE_PX + TILE_BUFFER_PX) / worldPx;
  const top = (y * TILE_PX - TILE_BUFFER_PX) / worldPx;
  const bottom = ((y + 1) * TILE_PX + TILE_BUFFER_PX) / worldPx;
  const clusters = [];
  const venues = [];
  const firstX = Math.max(0, Math.floor(left * level.tiles));
  const lastX = Math.min(level.tiles - 1, Math.floor(right * level.tiles));
  const firstY = Math.max(0, Math.floor(top * level.tiles));
  const lastY = Math.min(level.tiles - 1, Math.floor(bottom * level.tiles));
  for (let bx = firstX; bx <= lastX; bx++) {
    for (let by = firstY; by <= lastY; by++) {
      const bucket = level.buckets.get(cellKey(bx, by));
      if (!bucket) continue;
      for (const i of bucket) {
        const px = level.x[i];
        const py = level.y[i];
        if (px < left || px > right || py < top || py > bottom) continue;
        const localX = Math.round(px * worldPx - x * TILE_PX);
        const localY = Math.round(py * worldPx - y * TILE_PX);
        if (level.id[i] >= 0) venues.push(localX, localY, level.id[i]);
        else clusters.push(localX, localY, level.count[i], level.flagged[i], level.expand[i]);
      }
    }
  }
  return { clusters, venues };
}

