import { promises as fs } from 'fs';
import path from 'path';

import {
  cellCenter,
  cellIndex,
  latToRow,
  lonToCol,
  MASK_BYTES,
  MASK_COLS,
  MASK_ROWS,
  setBit,
} from '../../shared/geo/landMaskGrid';
import {
  classifyRouteQuality,
  computeSeaRoute,
  computeSeaRouteCells,
  findNearestWater,
  isWater,
  loadLandMask,
  setLandMaskForTesting,
  setSearouteForTesting,
} from '../seaRouter';

/**
 * Build an in-memory mask of the full grid size where every cell is
 * land except the ones explicitly opened as water. Lets us exercise
 * the A* / BFS code paths on a hand-crafted topology without involving
 * the 810 KB real raster.
 */
function buildAllLandMask(): Uint8Array {
  const bytes = new Uint8Array(MASK_BYTES);
  bytes.fill(0xff); // every bit = land
  return bytes;
}

function openWater(bytes: Uint8Array, row: number, col: number): void {
  setBit(bytes, cellIndex(row, col), 0);
}

describe('seaRouter — with real Natural Earth mask', () => {
  let maskExists = false;

  beforeAll(async () => {
    const maskPath = path.resolve(__dirname, '..', '..', '..', 'data', 'land-mask-0.1deg.bin');
    try {
      await fs.access(maskPath);
      maskExists = true;
    } catch {
      maskExists = false;
    }
    // Make sure tests in this block use the disk mask, not whatever a
    // previous test suite left behind via setLandMaskForTesting.
    setLandMaskForTesting(null);
    if (maskExists) {
      await loadLandMask();
    }
  });

  afterAll(() => {
    setLandMaskForTesting(null);
  });

  it('reports the middle of the North Atlantic as water', () => {
    if (!maskExists) return;
    // ~500 km west of Ireland, deep ocean.
    expect(isWater(50, -20)).toBe(true);
  });

  it('reports the middle of the Sahara as land', () => {
    if (!maskExists) return;
    // Well inside the Libyan desert.
    expect(isWater(25, 20)).toBe(false);
  });

  it('computes a Mediterranean route (Barcelona → Civitavecchia) that stays in the Med', async () => {
    if (!maskExists) return;
    const barcelona = { lat: 41.38, lon: 2.17 };
    const civitavecchia = { lat: 42.1, lon: 11.8 };
    const route = await computeSeaRoute(barcelona, civitavecchia);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.type).toBe('LineString');
    expect(route.coordinates.length).toBeGreaterThan(2);

    // Bounding-box check: latitudes stay between ~38° and ~44°, longitudes
    // between ~2° and ~13°. If A* were to loop via Gibraltar it would need
    // to visit roughly (36°, -5°), which would blow past the bbox. Some
    // slack on each side to accommodate slight coastline detours.
    for (const [lon, lat] of route.coordinates) {
      expect(lat).toBeGreaterThan(38);
      expect(lat).toBeLessThan(45);
      expect(lon).toBeGreaterThan(1);
      expect(lon).toBeLessThan(13);
    }
  }, 30000);

  it('returns null when one port is fully landlocked (Moscow → Barcelona)', async () => {
    if (!maskExists) return;
    const moscow = { lat: 55.75, lon: 37.6 };
    const barcelona = { lat: 41.38, lon: 2.17 };
    const route = await computeSeaRoute(moscow, barcelona);
    // Either null because BFS couldn't find water within 50 cells, or — if
    // it accidentally snapped to a small Volga pixel — A* would fail to
    // reach the sea. Either way, we never want a valid route.
    expect(route).toBeNull();
  }, 30000);

  it('takes the great-circle short-circuit on an open-ocean pair (no land samples)', async () => {
    if (!maskExists) return;
    // Middle of the Atlantic → middle of the Atlantic: no land in between,
    // the fine-mask GC-safety test should return 0 hits and the pipeline
    // emits a 65-vertex slerp polyline.
    const a = { lat: 40, lon: -30 };
    const b = { lat: 45, lon: -20 };
    setSearouteForTesting(() => {
      throw new Error('searoute should not be called on a GC-safe pair');
    });
    try {
      const route = await computeSeaRoute(a, b);
      expect(route).not.toBeNull();
      if (!route) return;
      // Adaptive GC samples at 64 steps → 65 vertices.
      expect(route.coordinates.length).toBe(65);
      // Endpoints are the raw ports (no cell-centre snap on the GC branch).
      expect(route.coordinates[0][0]).toBeCloseTo(a.lon, 5);
      expect(route.coordinates[0][1]).toBeCloseTo(a.lat, 5);
      expect(route.coordinates[route.coordinates.length - 1][0]).toBeCloseTo(b.lon, 5);
      expect(route.coordinates[route.coordinates.length - 1][1]).toBeCloseTo(b.lat, 5);
    } finally {
      setSearouteForTesting(null);
    }
  }, 30000);

  it('honours a searoute stub polyline whose segments stay clear of land', async () => {
    if (!maskExists) return;
    // Hamburg ↔ NYC is the canonical transatlantic case: fine-GC reports
    // land hits (Iceland / Greenland on the direct path), pipeline
    // proceeds to searoute-ts. Stub returns a densely-sampled North
    // Atlantic polyline (~50 km spacing) — short enough that segment-
    // level land-run analysis stays below the 40 km repair threshold
    // so the stub is returned verbatim.
    const hamburg = { lat: 53.551, lon: 9.993 };
    const nyc = { lat: 40.713, lon: -74.006 };
    const waypoints: Array<[number, number]> = [
      [9.993, 53.551],
      [3.5, 53.6],
      [-3.0, 51.0], // English Channel exit
      [-10.0, 48.5],
      [-20.0, 46.0],
      [-30.0, 44.0],
      [-40.0, 43.0],
      [-50.0, 42.5],
      [-60.0, 41.8],
      [-70.0, 41.0],
      [-74.006, 40.713],
    ];
    // Densify every leg to ~50 km spacing so the per-segment land-run
    // analysis never spans more than a few 0.05° cells of coastline.
    const stubCoords: [number, number][] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [lonA, latA] = waypoints[i];
      const [lonB, latB] = waypoints[i + 1];
      const N = 20;
      for (let s = 0; s < N; s++) {
        const t = s / N;
        stubCoords.push([lonA + (lonB - lonA) * t, latA + (latB - latA) * t]);
      }
    }
    stubCoords.push([nyc.lon, nyc.lat]);
    setSearouteForTesting(() => ({
      geometry: { coordinates: stubCoords },
      properties: { length: 6500 },
    }));
    try {
      const route = await computeSeaRoute(hamburg, nyc);
      expect(route).not.toBeNull();
      if (!route) return;
      // First + last vertices must match the stub (no endpoint-snap
      // replacement happened — the guard passed).
      expect(route.coordinates[0]).toEqual(stubCoords[0]);
      expect(route.coordinates[route.coordinates.length - 1]).toEqual(
        stubCoords[stubCoords.length - 1],
      );
      // Polyline length stays near the stub's length (repairs may have
      // stitched minor detours but we didn't fall into whole-route A*,
      // which would produce a materially different shape).
      expect(route.coordinates.length).toBeGreaterThan(50);
    } finally {
      setSearouteForTesting(null);
    }
  }, 30000);

  it('rejects a searoute stub whose endpoint snaps far from the port and falls back to 0.1° A*', async () => {
    if (!maskExists) return;
    // Classic Miami ↔ Nassau smell: stub returns a polyline that starts
    // ~400 km away from Miami (graph sparseness). Endpoint-snap guard
    // must reject and fall through to whole-route A*.
    const miami = { lat: 25.77, lon: -80.19 };
    const nassau = { lat: 25.05, lon: -77.35 };
    const stubCoords: [number, number][] = [
      [-76.0, 23.0], // ~430 km SE of Miami — obvious snap failure
      [-76.5, 24.5],
      [nassau.lon, nassau.lat],
    ];
    setSearouteForTesting(() => ({
      geometry: { coordinates: stubCoords },
      properties: { length: 400 },
    }));
    try {
      const route = await computeSeaRoute(miami, nassau);
      expect(route).not.toBeNull();
      if (!route) return;
      // A* output must start at or very close to Miami, not at -76/23.
      const firstDelta = Math.hypot(
        route.coordinates[0][0] - miami.lon,
        route.coordinates[0][1] - miami.lat,
      );
      expect(firstDelta).toBeLessThan(1.5); // well within 150 km
    } finally {
      setSearouteForTesting(null);
    }
  }, 30000);

  it('routes Istanbul → Odesa through the Bosporus (canal override)', async () => {
    if (!maskExists) return;
    // Without the Bosporus canal override, the Sea of Marmara is cut off
    // from the Black Sea at 0.1° resolution — this test would fail.
    const istanbul = { lat: 41.0082, lon: 28.9784 };
    const odesa = { lat: 46.4825, lon: 30.7233 };
    const route = await computeSeaRoute(istanbul, odesa);
    expect(route).not.toBeNull();
    if (!route) return;

    // The path must pass close to the Bosporus axis (41.12°, 29.07°).
    const passesBosporus = route.coordinates.some(
      ([lon, lat]) => Math.abs(lat - 41.12) < 0.3 && Math.abs(lon - 29.07) < 0.3,
    );
    expect(passesBosporus).toBe(true);
  }, 30000);

  it('falls through to whole-route A* when local repair leaves unresolved land-crossings', async () => {
    if (!maskExists) return;
    // Reproduces the Aegean / Kuşadası→Istanbul production bug. Stub
    // searoute-ts with a polyline that skirts south of Crete then cuts
    // straight across mainland Greece (Thessalia) before arriving at
    // Istanbul. Each inter-waypoint chord spans multiple 0.1° land cells
    // in the Greek interior — far beyond what the fine-A* repair budget
    // can stitch back together.
    //
    // Pre-fix: `localRepairAcrossLand` reports `repaired > 0` on the
    // detected bad runs even when the A* sub-call gives up on every one
    // of them, so the caller accepts the still-broken polyline. The
    // returned route contains a vertex deep in continental Greece.
    //
    // Post-fix: unresolved > 0 forces the whole-route A* fallback, which
    // routes water-only around the Peloponnese (or returns null) — never
    // the original mainland waypoints.
    const kusadasi = { lat: 37.86, lon: 27.26 };
    const istanbul = { lat: 41.01, lon: 28.98 };
    const stubCoords: [number, number][] = [
      [27.26, 37.86], // Kuşadası
      [23.6, 36.5], // south of Crete
      [24.5, 38.5], // over western Greek mainland
      [25.5, 39.5], // Thessalia — deep mainland (~200 km inland)
      [27.0, 40.8], // Sea of Marmara
      [28.98, 41.01], // Istanbul
    ];
    setSearouteForTesting(() => ({
      geometry: { coordinates: stubCoords },
      properties: { length: 1500 },
    }));
    try {
      const route = await computeSeaRoute(kusadasi, istanbul);
      // Null is acceptable (whole-route A* could fail too if the strait
      // can't be crossed). What we refuse is the stub's mainland-Greece
      // waypoints passing through untouched.
      if (route === null) return;

      // The stub's [24.5, 38.5] and [25.5, 39.5] are deep in continental
      // Europe — [24.5, 38.5] is in the Pindus mountains of central
      // Greece. If the buggy `repaired > 0` branch were still active the
      // fine-A* repair would give up on the 5°-wide land chord between
      // stub waypoints, leave the stub polyline untouched and those
      // mainland points would survive to the output. Whole-route A* on
      // the 0.1° water mask physically can't produce them.
      const preservesStubLandWaypoint = route.coordinates.some(
        ([lon, lat]) =>
          Math.abs(lon - 24.5) < 0.15 && Math.abs(lat - 38.5) < 0.15,
      );
      expect(preservesStubLandWaypoint).toBe(false);

      // And every vertex must be water per the 0.1° mask (endpoints are
      // port cells — the land-mask may still classify them as land if
      // they sit in a harbour; skip the first and last).
      for (let i = 1; i < route.coordinates.length - 1; i++) {
        const [lon, lat] = route.coordinates[i];
        expect(isWater(lat, lon)).toBe(true);
      }
    } finally {
      setSearouteForTesting(null);
    }
  }, 60000);
});

describe('seaRouter — on a synthetic 10×10 mask', () => {
  afterEach(() => {
    setLandMaskForTesting(null);
  });

  it('findNearestWater returns the port cell itself when already on water', () => {
    const bytes = buildAllLandMask();
    // Open a small patch of water at (row=900, col=1800) — roughly (0°, 0°).
    const row = 900;
    const col = 1800;
    openWater(bytes, row, col);
    setLandMaskForTesting(bytes);

    const center = cellCenter(row, col);
    const res = findNearestWater(center.lat, center.lon, 50);
    expect(res).not.toBeNull();
    // `findNearestWater` returns the water cell's centre — compare within
    // half a cell to avoid floating-point noise.
    expect(Math.abs((res as { lat: number }).lat - center.lat)).toBeLessThan(0.1);
    expect(Math.abs((res as { lon: number }).lon - center.lon)).toBeLessThan(0.1);
  });

  it('findNearestWater walks outward to the nearest open cell', () => {
    const bytes = buildAllLandMask();
    const portRow = 900;
    const portCol = 1800;
    // Place water exactly 3 rows north of the port.
    const waterRow = portRow + 3;
    const waterCol = portCol;
    openWater(bytes, waterRow, waterCol);
    setLandMaskForTesting(bytes);

    const portCenter = cellCenter(portRow, portCol);
    const res = findNearestWater(portCenter.lat, portCenter.lon, 200);
    expect(res).not.toBeNull();

    const waterCenter = cellCenter(waterRow, waterCol);
    expect(Math.abs((res as { lat: number }).lat - waterCenter.lat)).toBeLessThan(0.1);
    expect(Math.abs((res as { lon: number }).lon - waterCenter.lon)).toBeLessThan(0.1);
  });

  it('findNearestWater returns null when no water is reachable in the budget', () => {
    const bytes = buildAllLandMask();
    setLandMaskForTesting(bytes);
    const res = findNearestWater(0, 0, 50);
    expect(res).toBeNull();
  });

  it('computeSeaRouteCells finds a straight corridor of water', () => {
    const bytes = buildAllLandMask();
    const row = 900;
    const startCol = 1800;
    const endCol = 1810;
    // Open a 1-row-tall, 11-cell-wide water corridor.
    for (let col = startCol; col <= endCol; col++) {
      openWater(bytes, row, col);
    }
    setLandMaskForTesting(bytes);

    const startIdx = cellIndex(row, startCol);
    const goalIdx = cellIndex(row, endCol);
    const path = computeSeaRouteCells(bytes, startIdx, goalIdx);
    expect(path).not.toBeNull();
    if (!path) return;
    expect(path[0]).toBe(startIdx);
    expect(path[path.length - 1]).toBe(goalIdx);
    // 11 cells in the corridor — optimal path visits each exactly once.
    expect(path.length).toBe(11);
  });

  it('computeSeaRouteCells returns null when start and goal are on disconnected seas', () => {
    const bytes = buildAllLandMask();
    const row = 900;
    // Two isolated water cells, no connection.
    openWater(bytes, row, 1800);
    openWater(bytes, row, 1900);
    setLandMaskForTesting(bytes);

    const path = computeSeaRouteCells(bytes, cellIndex(row, 1800), cellIndex(row, 1900), {
      maxVisited: 100,
    });
    expect(path).toBeNull();
  });

  it('computeSeaRouteCells refuses a start cell that is land', () => {
    const bytes = buildAllLandMask();
    const row = 900;
    openWater(bytes, row, 1900);
    setLandMaskForTesting(bytes);

    const path = computeSeaRouteCells(bytes, cellIndex(row, 1800), cellIndex(row, 1900));
    expect(path).toBeNull();
  });

  it('latToRow / lonToCol round-trip through cellCenter', () => {
    // Simple sanity check that helpers agree on the grid geometry.
    const lat = 41.38;
    const lon = 2.17;
    const row = latToRow(lat);
    const col = lonToCol(lon);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(MASK_ROWS);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(MASK_COLS);
    const center = cellCenter(row, col);
    expect(Math.abs(center.lat - lat)).toBeLessThan(0.1);
    expect(Math.abs(center.lon - lon)).toBeLessThan(0.1);
  });
});

describe('classifyRouteQuality', () => {
  // Use a synthetic 10×10 water patch so every interior vertex we pick
  // classifies one way or the other predictably. Coordinates outside
  // the patch are "land" by construction.
  beforeAll(() => {
    const bytes = buildAllLandMask();
    const row = 900;
    for (let col = 1790; col <= 1810; col++) openWater(bytes, row, col);
    setLandMaskForTesting(bytes);
  });

  afterAll(() => {
    setLandMaskForTesting(null);
  });

  it('returns good for a fully water-interior route', () => {
    // Endpoints anywhere; the three interior vertices sit on the open
    // water corridor (row=900 cells 1800, 1801, 1802 → roughly 0°E).
    const c1 = cellCenter(900, 1800);
    const c2 = cellCenter(900, 1801);
    const c3 = cellCenter(900, 1802);
    const res = classifyRouteQuality([
      [0, 0],
      [c1.lon, c1.lat],
      [c2.lon, c2.lat],
      [c3.lon, c3.lat],
      [10, 10],
    ]);
    expect(res.quality).toBe('good');
    expect(res.landRatio).toBe(0);
  });

  it('returns schematic when ≥ 25 % of interior vertices are land', () => {
    // 4 interior vertices, 2 land (50 %) — well above the 25 % threshold.
    const c1 = cellCenter(900, 1800);
    const c2 = cellCenter(900, 1801);
    const res = classifyRouteQuality([
      [0, 0],
      [c1.lon, c1.lat],
      [c2.lon, c2.lat],
      [50, 20], // Sahara-ish — land
      [45, 10], // land
      [10, 10],
    ]);
    expect(res.quality).toBe('schematic');
    expect(res.landRatio).toBe(0.5);
  });

  it('ignores endpoints when classifying (river-port safety)', () => {
    // Both endpoints are land (Hamburg-style). Single interior vertex
    // is water. Should read as good despite land endpoints.
    const c1 = cellCenter(900, 1800);
    const res = classifyRouteQuality([
      [10, 53], // land
      [c1.lon, c1.lat],
      [10, 54], // land
    ]);
    expect(res.quality).toBe('good');
  });

  it('returns good for a 2-point chord (no interior to score)', () => {
    const res = classifyRouteQuality([
      [0, 0],
      [1, 1],
    ]);
    expect(res.quality).toBe('good');
    expect(res.landRatio).toBe(0);
  });

  it('classifies the 25 % threshold case as schematic (boundary)', () => {
    // 4 interior vertices, 1 land (25 % exactly) — threshold is inclusive.
    const c1 = cellCenter(900, 1800);
    const c2 = cellCenter(900, 1801);
    const c3 = cellCenter(900, 1802);
    const res = classifyRouteQuality([
      [0, 0],
      [c1.lon, c1.lat],
      [c2.lon, c2.lat],
      [c3.lon, c3.lat],
      [50, 20], // land — 1/4 = 25 %
      [10, 10],
    ]);
    expect(res.quality).toBe('schematic');
    expect(res.landRatio).toBe(0.25);
  });
});
