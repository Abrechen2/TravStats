import {
  MASK1_BYTES,
  MASK1_COLS,
  MASK1_ROWS,
  cellIndex1,
  latToRow1,
  lonToCol1,
  setBit1,
} from '../../shared/geo/landMaskGridCoarse';
import {
  MASK_BYTES,
  MASK_COLS,
  cellIndex,
  latToRow,
  lonToCol,
} from '../../shared/geo/landMaskGrid';
import {
  clearSchematicRouteCache,
  computeSchematicRoute,
  getSchematicRouteCacheStats,
  setCoarseMaskForTesting,
  simplifyDegrees,
} from '../schematicRouter';

function allWaterMask(): Uint8Array {
  // Default mask = all zero bits = all water.
  return new Uint8Array(MASK1_BYTES);
}

function allLandMask(): Uint8Array {
  const bytes = new Uint8Array(MASK1_BYTES);
  bytes.fill(0xff);
  return bytes;
}

/** Companion fine 0.1° all-water mask. The short-hop bypass guards
 * itself against fjord-crossing chords by sampling the fine mask, so
 * tests that exercise the bypass need a non-null fine mask. */
function allWaterFineMask(): Uint8Array {
  return new Uint8Array(MASK_BYTES);
}

describe('schematicRouter — computeSchematicRoute', () => {
  afterEach(() => {
    setCoarseMaskForTesting(null);
  });

  it('returns dep + arr as direct chord when all water (short hop)', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      { lat: 40, lon: 0 },
      { lat: 42, lon: 3 },
    );
    expect(r.routed).toBe(true);
    expect(r.waypoints[0]).toEqual([0, 40]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual([3, 42]);
  });

  it('first and last waypoints are always the raw port coords', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      { lat: 35.5, lon: 10.3 },
      { lat: 45.7, lon: -15.2 },
    );
    expect(r.waypoints[0]).toEqual([10.3, 35.5]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual([-15.2, 45.7]);
  });

  it('falls back to a direct 2-point chord when both ports are surrounded by land', async () => {
    // All land, no water anywhere — findNearestWaterCell gives up.
    setCoarseMaskForTesting(allLandMask());
    const r = await computeSchematicRoute(
      { lat: 40, lon: 0 },
      { lat: 42, lon: 3 },
    );
    expect(r.routed).toBe(false);
    expect(r.waypoints).toEqual([[0, 40], [3, 42]]);
  });

  it('falls back to a direct chord when dep-water and arr-water are disconnected', async () => {
    // Two tiny water islands on otherwise-land grid, no A* connection.
    const bytes = allLandMask();
    // Open one water cell near dep, one far from arr — the BFS from
    // dep will find its cell instantly but A* can't reach arr's cell.
    const depRow = latToRow1(40);
    const depCol = lonToCol1(0);
    setBit1(bytes, cellIndex1(depRow, depCol), 0);
    const arrRow = latToRow1(-40);
    const arrCol = lonToCol1(150);
    setBit1(bytes, cellIndex1(arrRow, arrCol), 0);
    setCoarseMaskForTesting(bytes);
    const r = await computeSchematicRoute(
      { lat: 40, lon: 0 },
      { lat: -40, lon: 150 },
    );
    expect(r.routed).toBe(false);
    expect(r.waypoints).toEqual([[0, 40], [150, -40]]);
  });

  it('always returns at least 2 waypoints', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      { lat: 35, lon: 10 },
      { lat: 35.2, lon: 10.1 },
    );
    expect(r.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('bypasses A* for short hops (< 150 km) when the chord is all-water', async () => {
    // Port pair ~80 km apart on an all-water coarse + fine mask. With
    // a clear fine-mask chord the bypass keeps the route to 2 points.
    setCoarseMaskForTesting(allWaterMask(), allWaterFineMask());
    const r = await computeSchematicRoute(
      { lat: 51.95, lon: 4.07 }, // ~Rotterdam Europoort
      { lat: 51.5, lon: 3.6 },   // ~Vlissingen / Middelburg approach
    );
    expect(r.routed).toBe(true);
    expect(r.waypoints).toEqual([[4.07, 51.95], [3.6, 51.5]]);
  });

  it('falls through to A* for short hops (< 150 km) when the chord clips land', async () => {
    // Two ports <150 km apart, but the fine-mask chord midpoint is
    // marked as land — simulates Bergen → Flåm crossing Norwegian
    // mountains. The bypass guard must reject the chord and let A*
    // route around the obstacle. Coarse mask is otherwise all water
    // so A* finds an unobstructed cell path between them.
    const fine = allWaterFineMask();
    // Mark a land block on the fine mask covering the chord midpoint
    // (~lat 60.6, lon 6.2).
    for (let lat = 60.4; lat <= 60.85; lat += 0.05) {
      for (let lon = 5.5; lon <= 7.0; lon += 0.05) {
        const r = latToRow(lat);
        const c = ((lonToCol(lon) % MASK_COLS) + MASK_COLS) % MASK_COLS;
        const idx = cellIndex(r, c);
        fine[idx >> 3] |= 1 << (idx & 7);
      }
    }
    setCoarseMaskForTesting(allWaterMask(), fine);
    const r = await computeSchematicRoute(
      { lat: 60.39, lon: 5.32 }, // Bergen
      { lat: 60.86, lon: 7.11 }, // Flåm
    );
    expect(r.routed).toBe(true);
    // A* on the all-water coarse grid still snaps to cell centres; the
    // critical assertion is "more than the bypass would have produced".
    expect(r.waypoints.length).toBeGreaterThan(2);
  });

  it('inserts a midpoint approach waypoint when a port snaps far from land (fjord case)', async () => {
    // Build a mask where the dep port's 1° cell and a wide neighbourhood
    // are land, with water only several cells away — simulates a fjord
    // head where BFS snap lands far offshore. Arr is on a normal water
    // cell. Verify that the dep-side smoothing waypoint shows up in the
    // route between the port and the snapped cell.
    const bytes = allLandMask();
    // Open water: a 3-row strip near lat 50N (rows ~40), and the arr
    // cell. BFS from dep port at (60, 5) snaps north to the strip.
    for (let lat = 49; lat <= 51; lat += 1) {
      for (let lon = -10; lon <= 20; lon += 1) {
        const r = latToRow1(lat);
        const c = lonToCol1(lon);
        setBit1(bytes, cellIndex1(r, c), 0);
      }
    }
    // Make sure the immediate ring around dep stays land — force snap distance.
    setCoarseMaskForTesting(bytes);
    const r = await computeSchematicRoute(
      { lat: 60, lon: 5 }, // dep "fjord" port, 1° cell is land
      { lat: 50, lon: 10 }, // arr in the open-water strip
    );
    expect(r.routed).toBe(true);
    // The first waypoint must still be the raw port.
    expect(r.waypoints[0]).toEqual([5, 60]);
    // The second waypoint is the smoothing midpoint, somewhere between
    // the port and the snapped water cell — i.e. north-ish of the port,
    // not at the snapped cell itself. Exact coordinates depend on which
    // cell BFS picks, but lat must lie strictly between 50 and 60.
    expect(r.waypoints.length).toBeGreaterThanOrEqual(3);
    expect(r.waypoints[1][1]).toBeGreaterThan(50);
    expect(r.waypoints[1][1]).toBeLessThan(60);
  });

  it('uses the fixed Hamburg approach before routing to open water', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      {
        name: 'Hamburg',
        city: 'Hamburg',
        country: 'Germany',
        unlocode: 'DEHAM',
        lat: 53.55,
        lon: 9.97,
      },
      { name: 'Bergen', city: 'Bergen', country: 'Norway', lat: 60.39, lon: 5.32 },
    );

    expect(r.routed).toBe(true);
    expect(r.protectedPrefixCount).toBe(8);
    // Bergen also has a 4-waypoint Hjeltefjorden approach corridor, so
    // the suffix is now protected (4 corridor + 1 port = 5 protected
    // points). The trailing slice still ends at the Bergen port itself.
    expect(r.protectedSuffixCount).toBe(5);
    expect(r.waypoints.slice(0, 8)).toEqual([
      [9.97, 53.55],
      [9.87, 53.54],
      [9.7, 53.56],
      [9.42, 53.79],
      [9.22, 53.86],
      [9.12, 53.88],
      [8.72, 53.9],
      [8.18, 54.05],
    ]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual([5.32, 60.39]);
  });

  it('uses the fixed Kiel approach so the Fehmarnbelt corridor is followed instead of Lübeck-Bay zigzag', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      {
        name: 'Kiel',
        city: 'Kiel',
        country: 'Germany',
        unlocode: 'DEKEL',
        lat: 54.32,
        lon: 10.13,
      },
      {
        name: 'Copenhagen',
        city: 'Copenhagen',
        country: 'Denmark',
        unlocode: 'DKCPH',
        lat: 55.69,
        lon: 12.57,
      },
    );

    expect(r.routed).toBe(true);
    expect(r.protectedPrefixCount).toBe(8);
    // First 8 waypoints: Kiel + 7 corridor points up through Fehmarnbelt
    // and out into the open Bay of Mecklenburg.
    expect(r.waypoints.slice(0, 8)).toEqual([
      [10.13, 54.32],
      [10.21, 54.4],
      [10.3, 54.5],
      [10.8, 54.55],
      [11.1, 54.65],
      [11.4, 54.65],
      [11.8, 54.7],
      [12.3, 54.8],
    ]);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual([12.57, 55.69]);
  });

  it('uses the fixed Kiel approach in reverse when Kiel is the arrival port', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      {
        name: 'Copenhagen',
        city: 'Copenhagen',
        country: 'Denmark',
        unlocode: 'DKCPH',
        lat: 55.69,
        lon: 12.57,
      },
      {
        name: 'Kiel',
        city: 'Kiel',
        country: 'Germany',
        unlocode: 'DEKEL',
        lat: 54.32,
        lon: 10.13,
      },
    );

    expect(r.routed).toBe(true);
    expect(r.protectedSuffixCount).toBe(8);
    expect(r.waypoints.slice(-8)).toEqual([
      [12.3, 54.8],
      [11.8, 54.7],
      [11.4, 54.65],
      [11.1, 54.65],
      [10.8, 54.55],
      [10.3, 54.5],
      [10.21, 54.4],
      [10.13, 54.32],
    ]);
  });

  it('uses the fixed Hamburg approach in reverse when Hamburg is the arrival port', async () => {
    setCoarseMaskForTesting(allWaterMask());
    const r = await computeSchematicRoute(
      { name: 'Bergen', city: 'Bergen', country: 'Norway', lat: 60.39, lon: 5.32 },
      {
        name: 'Hamburg',
        city: 'Hamburg',
        country: 'Germany',
        unlocode: 'DEHAM',
        lat: 53.55,
        lon: 9.97,
      },
    );

    expect(r.routed).toBe(true);
    // Bergen now has its own approach corridor (4 outbound waypoints +
    // the port itself = 5 protected leading waypoints).
    expect(r.protectedPrefixCount).toBe(5);
    expect(r.protectedSuffixCount).toBe(8);
    expect(r.waypoints.slice(-8)).toEqual([
      [8.18, 54.05],
      [8.72, 53.9],
      [9.12, 53.88],
      [9.22, 53.86],
      [9.42, 53.79],
      [9.7, 53.56],
      [9.87, 53.54],
      [9.97, 53.55],
    ]);
  });
});

describe('simplifyDegrees (Douglas-Peucker in degree space)', () => {
  it('keeps a straight line as 2 points', () => {
    const out = simplifyDegrees(
      [
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
      0.5,
    );
    expect(out).toEqual([
      [0, 0],
      [4, 4],
    ]);
  });

  it('keeps a peak point when the tolerance demands it', () => {
    const out = simplifyDegrees(
      [
        [0, 0],
        [2, 3], // peak — deviates from chord
        [4, 0],
      ],
      0.5,
    );
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual([2, 3]);
  });

  it('drops the peak when tolerance is loose enough', () => {
    const out = simplifyDegrees(
      [
        [0, 0],
        [2, 0.1], // barely off the chord
        [4, 0],
      ],
      1,
    );
    expect(out).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it('preserves endpoints unconditionally', () => {
    const out = simplifyDegrees(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      10,
    );
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([2, 0]);
  });

  it('returns input unchanged for ≤ 2 points', () => {
    expect(simplifyDegrees([], 1)).toEqual([]);
    expect(simplifyDegrees([[0, 0]], 1)).toEqual([[0, 0]]);
    expect(simplifyDegrees([[0, 0], [1, 1]], 1)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('schematicRouter — route cache', () => {
  beforeEach(() => {
    clearSchematicRouteCache();
    setCoarseMaskForTesting(allWaterMask());
  });

  afterEach(() => {
    clearSchematicRouteCache();
    setCoarseMaskForTesting(null);
  });

  it('caches identical (depId, arrId) pairs and serves from memory on second call', async () => {
    const dep = { id: 1, lat: 40, lon: 0 };
    const arr = { id: 2, lat: 42, lon: 3 };

    const first = await computeSchematicRoute(dep, arr);
    const stats1 = getSchematicRouteCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.hits).toBe(0);
    expect(stats1.size).toBe(1);

    const second = await computeSchematicRoute(dep, arr);
    const stats2 = getSchematicRouteCacheStats();
    expect(stats2.misses).toBe(1);
    expect(stats2.hits).toBe(1);
    expect(second).toBe(first); // identity — same cached object
  });

  it('treats reversed direction as a separate cache entry', async () => {
    const a = { id: 1, lat: 40, lon: 0 };
    const b = { id: 2, lat: 42, lon: 3 };

    await computeSchematicRoute(a, b);
    await computeSchematicRoute(b, a);
    const stats = getSchematicRouteCacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(2);
  });

  it('does not cache when either port lacks an id', async () => {
    await computeSchematicRoute({ lat: 40, lon: 0 }, { lat: 42, lon: 3 });
    await computeSchematicRoute({ id: 1, lat: 40, lon: 0 }, { lat: 42, lon: 3 });
    await computeSchematicRoute({ lat: 40, lon: 0 }, { id: 2, lat: 42, lon: 3 });
    const stats = getSchematicRouteCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    // misses are not bumped for uncacheable lookups either — they're skipped entirely.
    expect(stats.misses).toBe(0);
  });

  it('clearSchematicRouteCache resets state', async () => {
    await computeSchematicRoute({ id: 1, lat: 40, lon: 0 }, { id: 2, lat: 42, lon: 3 });
    expect(getSchematicRouteCacheStats().size).toBe(1);
    clearSchematicRouteCache();
    const stats = getSchematicRouteCacheStats();
    expect(stats).toEqual({ size: 0, hits: 0, misses: 0, hitRate: 0 });
  });
});
