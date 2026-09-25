import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CLUSTER_ZOOM, MIN_CLUSTER_ZOOM, TILE_BUFFER_PX, TILE_PX, buildClusterIndex, projectX, projectY, tileItems,
} from "./map-cluster.mjs";

// Deterministic pseudo-random venues: dense towns plus a sparse countryside.
function syntheticVenues(count, countryside = true) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const towns = [[45.46, 9.19], [41.9, 12.5], [40.85, 14.27], [45.44, 12.33]];
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const [lat, lon] = countryside && i % 5 === 0 ? [37 + random() * 9, 7 + random() * 11]
      : towns[i % towns.length].map((value) => value + (random() - 0.5) * 0.1);
    xs[i] = projectX(lon);
    ys[i] = projectY(lat);
    flags[i] = i % 7 === 0 ? 1 : 0;
  }
  return { xs, ys, flags, ids: Int32Array.from({ length: count }, (_, i) => i) };
}

function tileRange(xs, ys, z) {
  const tiles = 2 ** z * 256 / TILE_PX;
  const range = (values) => [Math.floor(Math.min(...values) * tiles), Math.floor(Math.max(...values) * tiles)];
  return [range(xs), range(ys)];
}

test("every zoom level conserves the venue and highlight counts", () => {
  const { xs, ys, flags, ids } = syntheticVenues(4000);
  const index = buildClusterIndex(xs, ys, ids, flags);
  const flagged = flags.reduce((sum, flag) => sum + flag, 0);
  for (let zoom = MIN_CLUSTER_ZOOM; zoom <= MAX_CLUSTER_ZOOM + 1; zoom++) {
    const level = index.levels[zoom];
    let count = 0;
    let highlighted = 0;
    for (let i = 0; i < level.size; i++) {
      count += level.count[i];
      highlighted += level.flagged[i];
      assert.ok(level.expand[i] > zoom || level.id[i] >= 0, "a cluster splits at a deeper zoom");
    }
    assert.equal(count, 4000, `zoom ${zoom}`);
    assert.equal(highlighted, flagged, `zoom ${zoom}`);
  }
  assert.ok(index.levels[6].size < 150, `the national view shows few bubbles (${index.levels[6].size})`);
  assert.equal(index.levels[MAX_CLUSTER_ZOOM + 1].size, 4000, "individual venues above the cluster zooms");
});

test("tiles partition the venues exactly, including items near tile edges", () => {
  const { xs, ys, flags, ids } = syntheticVenues(3000, false);
  const index = buildClusterIndex(xs, ys, ids, flags);
  for (const zoom of [5, 8, 11, 14, 17]) {
    const [[x0, x1], [y0, y1]] = tileRange(xs, ys, zoom);
    let owned = 0;
    let buffered = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const { clusters, venues } = tileItems(index, zoom, x, y);
        const inside = (px, py) => px >= 0 && px < TILE_PX && py >= 0 && py < TILE_PX;
        for (let k = 0; k < clusters.length; k += 5) {
          if (inside(clusters[k], clusters[k + 1])) owned += clusters[k + 2];
          else buffered++;
          assert.ok(clusters[k] >= -TILE_BUFFER_PX && clusters[k] <= TILE_PX + TILE_BUFFER_PX);
        }
        for (let k = 0; k < venues.length; k += 3) {
          if (inside(venues[k], venues[k + 1])) owned++;
          else buffered++;
        }
      }
    }
    // Positions are rounded in world pixels, so each item is owned by exactly one tile.
    assert.equal(owned, 3000, `zoom ${zoom}`);
    if (zoom >= 11) assert.ok(buffered > 0, "edge items are shared with the neighbouring tile");
  }
});

test("a filtered subset clusters only the selected venues", () => {
  const { xs, ys, flags } = syntheticVenues(1000);
  const subset = Int32Array.from([3, 10, 500, 999]);
  const index = buildClusterIndex(xs, ys, subset, flags);
  const points = index.levels[MAX_CLUSTER_ZOOM + 1];
  assert.deepEqual([...points.id.slice(0, points.size)].sort((a, b) => a - b), [3, 10, 500, 999]);
});
