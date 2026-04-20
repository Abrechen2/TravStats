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
  computeSeaRoute,
  computeSeaRouteCells,
  findNearestWater,
  isWater,
  loadLandMask,
  setLandMaskForTesting,
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
