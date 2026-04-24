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
  computeSchematicRoute,
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
