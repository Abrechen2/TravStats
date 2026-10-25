import { TILES, tileOf, type Bbox, type Cell } from "../cells";
import { circleCells, exploredView } from "../privacy";
import { fillComponent } from "../zoneRaster";

/**
 * The explored map's one privacy model (TravTrack plan L1, review focus 26;
 * Codex review of a3353f2a7): a privacy zone is never a hole and never a
 * shape of its own. Its cells are decided by the SURROUNDINGS, not by the
 * circle — a zone cell is drawn when at least three of its four directions
 * reach explored ground (through other zone cells), closed to a fixed point
 * with the same three-of-four count on its edge neighbours. A zone inside
 * explored ground fills in; a zone at the edge of explored ground follows the
 * surroundings' edge; a zone nobody moved around draws (almost) nothing.
 */

const key = (c: Cell) => `${c.x}/${c.y}`;
const keys = (cells: readonly Cell[]) => new Set(cells.map(key));
const WORLD: Bbox = { west: -180, south: -85, east: 180, north: 85 };

/** A 5 km zone in Berlin. */
const zone = { lat: 52.52, lon: 13.405, radiusM: 5_000 };

function boxOf(cells: readonly Cell[]) {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Every cell of the zone's tile box widened by `width`, minus the zone's own cells. */
function around(cells: readonly Cell[], width: number, keep: (c: Cell) => boolean = () => true) {
  const inner = keys(cells);
  const b = boxOf(cells);
  const out: Cell[] = [];
  for (let x = b.x0 - width; x <= b.x1 + width; x++) {
    for (let y = b.y0 - width; y <= b.y1 + width; y++) {
      if (!inner.has(`${x}/${y}`) && keep({ x, y })) out.push({ x, y });
    }
  }
  return out;
}

describe("the explored map's privacy model", () => {
  const zoneCells = circleCells(zone);
  const zoneKeys = keys(zoneCells);
  const zoneIn = (view: readonly Cell[]) => view.filter((c) => zoneKeys.has(key(c)));

  it("a 5 km circle touches the cells around its centre, and only nearby ones", () => {
    expect(zoneCells.length).toBeGreaterThan(9);
    expect(zoneKeys.has(key(tileOf(zone.lat, zone.lon)))).toBe(true);
    expect(zoneKeys.has(key(tileOf(52.7, 13.405)))).toBe(false);
  });

  it("a zone fully surrounded by explored cells is filled whole: no hole", () => {
    const explored = around(zoneCells, 2);
    const view = keys(exploredView({ explored, circles: [zone], bbox: WORLD }));
    for (const c of zoneCells) expect(view.has(key(c))).toBe(true);
    expect(view.size).toBe(zoneCells.length + explored.length);
  });

  it("one explored cell beside a 5 km zone draws (almost) none of it — no circle footprint", () => {
    const b = boxOf(zoneCells);
    const midY = Math.round((b.y0 + b.y1) / 2);
    const explored = [{ x: b.x1 + 1, y: midY }];
    const view = exploredView({ explored, circles: [zone], bbox: WORLD });
    expect(zoneIn(view).length).toBeLessThanOrEqual(1);
  });

  it("a road along one side draws none of the zone", () => {
    const b = boxOf(zoneCells);
    const road = Array.from({ length: b.y1 - b.y0 + 7 }, (_, i) => ({
      x: b.x1 + 1,
      y: b.y0 - 3 + i,
    }));
    const view = exploredView({ explored: road, circles: [zone], bbox: WORLD });
    expect(zoneIn(view)).toEqual([]);
  });

  it("a zone at the edge of explored ground follows the surroundings' edge, not the circle", () => {
    // Explored ground west of the zone's centre column, nothing east of it.
    const b = boxOf(zoneCells);
    const edge = tileOf(zone.lat, zone.lon).x;
    const explored = around(zoneCells, 3, (c) => c.x < edge);
    const drawn = zoneIn(exploredView({ explored, circles: [zone], bbox: WORLD }));
    // West of the edge filled, east of it empty: the line between them is the
    // surroundings' edge (one column), not the circle's eastern arc.
    expect(drawn.length).toBeGreaterThan(0);
    for (const c of drawn) expect(c.x).toBeLessThan(edge);
    for (const c of zoneCells.filter((z) => z.x < edge - 1 && z.y > b.y0 + 1 && z.y < b.y1 - 1)) {
      expect(keys(drawn).has(key(c))).toBe(true);
    }
  });

  it("an isolated zone with no explored neighbour emits nothing", () => {
    const far = tileOf(48.1, 11.5);
    expect(exploredView({ explored: [far], circles: [zone], bbox: WORLD })).toEqual([far]);
    expect(exploredView({ explored: [], circles: [zone], bbox: WORLD })).toEqual([]);
  });

  it("the answer inside any box is the whole answer cut to it — boxes cannot be differenced", () => {
    const explored = around(zoneCells, 2);
    const whole = exploredView({ explored, circles: [zone], bbox: WORLD });
    for (const small of [
      { west: 13.3, south: 52.45, east: 13.42, north: 52.53 },
      { west: 13.4, south: 52.5, east: 13.41, north: 52.51 },
      { west: 13.0, south: 52.3, east: 13.8, north: 52.8 },
    ]) {
      const part = exploredView({ explored, circles: [zone], bbox: small });
      expect(part).toEqual(exploredView({ explored: whole, circles: [], bbox: small }));
    }
  });

  it("a zone across the date line covers both edges of the grid and fills across them", () => {
    const pacific = { lat: -16.5, lon: 179.99, radiusM: 5_000 };
    const cells = circleCells(pacific);
    const xs = new Set(cells.map((c) => c.x));
    expect(xs.has(TILES - 1)).toBe(true);
    expect(xs.has(0)).toBe(true);
    // Surrounded on both sides of the line: filled whole.
    const ys = cells.map((c) => c.y);
    const [y0, y1] = [Math.min(...ys) - 2, Math.max(...ys) + 2];
    const inZone = keys(cells);
    const explored: Cell[] = [];
    for (let y = y0; y <= y1; y++) {
      for (const x of [
        TILES - 6,
        TILES - 5,
        TILES - 4,
        TILES - 3,
        TILES - 2,
        TILES - 1,
        0,
        1,
        2,
        3,
        4,
        5,
      ]) {
        if (!inZone.has(`${x}/${y}`)) explored.push({ x, y });
      }
    }
    const view = keys(exploredView({ explored, circles: [pacific], bbox: WORLD }));
    for (const c of cells) expect(view.has(key(c))).toBe(true);
  });

  it("no answer ever holds a hole at a zone: every zone cell left out is open on two sides at least", () => {
    // A seeded pseudo-random walk of explored ground around the zone, many times.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const b = boxOf(zoneCells);
    for (let round = 0; round < 40; round++) {
      const explored: Cell[] = [];
      const density = rand();
      for (let x = b.x0 - 3; x <= b.x1 + 3; x++) {
        for (let y = b.y0 - 3; y <= b.y1 + 3; y++) {
          if (!zoneKeys.has(`${x}/${y}`) && rand() < density) explored.push({ x, y });
        }
      }
      const ex = keys(explored);
      const drawn = keys(exploredView({ explored, circles: [zone], bbox: WORLD }));
      const reaches = (c: Cell, dx: number, dy: number) => {
        for (let k = 1; ; k++) {
          const n = `${c.x + dx * k}/${c.y + dy * k}`;
          if (ex.has(n)) return true;
          if (!zoneKeys.has(n)) return false;
        }
      };
      for (const c of zoneCells) {
        if (drawn.has(key(c))) continue;
        const closed = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dy]) => reaches(c, dx, dy)).length;
        expect(closed).toBeLessThanOrEqual(2);
      }
    }
  });

  it("deciding a zone is linear: 40 000 zone cells inside a ring in well under a second", () => {
    const component: Cell[] = [];
    for (let x = 1000; x < 1200; x++) for (let y = 3000; y < 3200; y++) component.push({ x, y });
    const ring: Cell[] = [];
    for (let i = 999; i <= 1200; i++) {
      ring.push(
        { x: i, y: 2999 },
        { x: i, y: 3200 },
        { x: 999, y: i + 2000 },
        { x: 1200, y: i + 2000 }
      );
    }
    const started = Date.now();
    const drawn = fillComponent(component, new Set(ring.map(key)));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(drawn).toHaveLength(component.length);
  });

  it("answers cells only, sorted, each once", () => {
    const explored = [tileOf(1, 1), tileOf(1, 1), tileOf(0.5, 0.5)];
    const view = exploredView({ explored, circles: [], bbox: WORLD });
    expect(view).toEqual([...view].sort((a, b) => a.x - b.x || a.y - b.y));
    expect(view).toHaveLength(2);
    for (const c of view) expect(Object.keys(c).sort()).toEqual(["x", "y"]);
  });
});
