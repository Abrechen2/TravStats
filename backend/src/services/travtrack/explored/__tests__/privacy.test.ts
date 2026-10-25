import { tileOf, type Bbox, type Cell } from "../cells";
import { circleCells, exploredView } from "../privacy";

/**
 * The explored map's one privacy model (TravTrack plan L1, review focus 26):
 * a privacy zone is shown as explored ground — never a hole, never a shape of
 * its own — by a fixed rule: the cells a privacy circle touches are drawn when
 * they connect, edge to edge through such cells, to an explored cell. A zone
 * nobody moved next to draws nothing.
 */

const key = (c: Cell) => `${c.x}/${c.y}`;
const keys = (cells: readonly Cell[]) => new Set(cells.map(key));
const WORLD: Bbox = { west: -180, south: -85, east: 180, north: 85 };

/** A 5 km zone in Berlin and every cell of a ring two cells wide around it. */
const zone = { lat: 52.52, lon: 13.405, radiusM: 5_000 };
function ringAround(cells: readonly Cell[], width: number): Cell[] {
  const inner = keys(cells);
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const out: Cell[] = [];
  for (let x = Math.min(...xs) - width; x <= Math.max(...xs) + width; x++) {
    for (let y = Math.min(...ys) - width; y <= Math.max(...ys) + width; y++) {
      if (!inner.has(`${x}/${y}`)) out.push({ x, y });
    }
  }
  return out;
}

describe("the explored map's privacy model", () => {
  const zoneCells = circleCells(zone);

  it("a 5 km circle touches the cells around its centre, and only nearby ones", () => {
    expect(zoneCells.length).toBeGreaterThan(9);
    expect(keys(zoneCells).has(key(tileOf(zone.lat, zone.lon)))).toBe(true);
    expect(keys(zoneCells).has(key(tileOf(52.7, 13.405)))).toBe(false);
  });

  it("a 5 km zone surrounded by explored cells leaves no hole: its cells are emitted", () => {
    const explored = ringAround(zoneCells, 2);
    const view = keys(exploredView({ explored, circles: [zone], bbox: WORLD }));
    for (const c of zoneCells) expect(view.has(key(c))).toBe(true);
    for (const c of explored) expect(view.has(key(c))).toBe(true);
    expect(view.size).toBe(zoneCells.length + explored.length);
  });

  it("a zone with explored ground on one side only is still drawn whole, not as a bite", () => {
    const edge = zoneCells.reduce((a, b) => (b.x > a.x ? b : a));
    const explored = [{ x: edge.x + 1, y: edge.y }];
    const view = keys(exploredView({ explored, circles: [zone], bbox: WORLD }));
    expect(view.size).toBe(zoneCells.length + 1);
  });

  it("an isolated zone with no explored neighbour emits nothing", () => {
    const far = { x: tileOf(48.1, 11.5).x, y: tileOf(48.1, 11.5).y };
    expect(exploredView({ explored: [far], circles: [zone], bbox: WORLD })).toEqual([far]);
    expect(exploredView({ explored: [], circles: [zone], bbox: WORLD })).toEqual([]);
  });

  it("a diagonal neighbour is not an edge neighbour", () => {
    const xs = zoneCells.map((c) => c.x);
    const ys = zoneCells.map((c) => c.y);
    const corner = { x: Math.max(...xs) + 1, y: Math.max(...ys) + 1 };
    // The corner outside the circle's tile box touches none of its cells by an edge.
    const view = exploredView({ explored: [corner], circles: [zone], bbox: WORLD });
    expect(view).toEqual([corner]);
  });

  it("the answer inside a smaller box is the larger answer cut to it — no other shape", () => {
    const explored = ringAround(zoneCells, 2);
    const whole = exploredView({ explored, circles: [zone], bbox: WORLD });
    const small: Bbox = { west: 13.3, south: 52.45, east: 13.42, north: 52.53 };
    const part = exploredView({ explored, circles: [zone], bbox: small });
    const inSmall = exploredView({ explored: whole, circles: [], bbox: small });
    expect(part).toEqual(inSmall);
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThan(whole.length);
  });

  it("answers cells only, sorted, each once", () => {
    const explored = [tileOf(1, 1), tileOf(1, 1), tileOf(0.5, 0.5)];
    const view = exploredView({ explored, circles: [], bbox: WORLD });
    expect(view).toEqual([...view].sort((a, b) => a.x - b.x || a.y - b.y));
    expect(view).toHaveLength(2);
    for (const c of view) expect(Object.keys(c).sort()).toEqual(["x", "y"]);
  });
});
