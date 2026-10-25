import { observeQueries, prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { createZone, deleteZone, updateZone } from "../../zones";
import { makeUser, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { tileOf, type Cell } from "../cells";
import { circleCells, exploredAnswer } from "../privacy";
import { MAX_FORMER_CIRCLES, MAX_ZONE_CELLS, rebuildZoneCells } from "../zoneCells";

/**
 * The explored map's zone raster (TravTrack plan L1; Codex review of
 * a3353f2a7): rebuilt in the transaction of every zone change, read per
 * request in a fixed number of bounded queries, and decided per zone on the
 * whole zone — so no box, however small or placed, answers differently for
 * a zone than the whole map does.
 */

const PREFIX = "travtrack-explored-zonecells-";
const BERLIN = { lat: 52.52, lon: 13.405, radiusM: 3_000 };
const MUNICH = { lat: 48.137, lon: 11.575, radiusM: 3_000 };
const key = (c: Cell) => `${c.x}/${c.y}`;

function ringAround(cells: readonly Cell[], width: number): Cell[] {
  const inner = new Set(cells.map(key));
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

describe("the explored map's zone raster", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const seed = (cells: readonly Cell[]) =>
    prisma.travTrackExploredCell.createMany({
      data: cells.map((c) => ({ userId, day: utcMidnight("2026-10-12"), x: c.x, y: c.y })),
      skipDuplicates: true,
    });
  const stored = () =>
    prisma.travTrackZoneCell.findMany({ where: { userId }, select: { x: true, y: true } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackExploredCell.deleteMany({ where: { userId } });
    await prisma.travTrackZoneCell.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("creating, moving and deleting a zone rebuild the raster in the same transaction", async () => {
    const { zone } = await createZone(userId, { name: "Zuhause", ...BERLIN }, true);
    expect((await stored()).length).toBe(circleCells(BERLIN).length);

    await updateZone(userId, zone.id, { lat: MUNICH.lat, lon: MUNICH.lon }, true);
    // The new circle, and the old one as a former zone's.
    const both = new Set([...circleCells(BERLIN), ...circleCells(MUNICH)].map(key));
    expect(new Set((await stored()).map(key))).toEqual(both);

    await deleteZone(userId, zone.id);
    expect(new Set((await stored()).map(key))).toEqual(both);
  });

  it("an account never built is built by its first request", async () => {
    await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Z", ...BERLIN } });
    await seed(ringAround(circleCells(BERLIN), 1));
    const box = { west: 13.3, south: 52.45, east: 13.5, north: 52.6 };

    const { cells } = await exploredAnswer(userId, box);

    const drawn = new Set(cells.map(key));
    for (const c of circleCells(BERLIN)) expect(drawn.has(key(c))).toBe(true);
    expect((await stored()).length).toBe(circleCells(BERLIN).length);
  });

  it("a box inside a zone answers what the whole map answers for it — the surroundings outside the box still count", async () => {
    await createZone(userId, { name: "Zuhause", ...BERLIN }, true);
    await createZone(userId, { name: "Eltern", ...MUNICH }, true);
    // Munich surrounded by a lot of explored ground, Berlin by a ring.
    await seed(ringAround(circleCells(MUNICH), 40));
    await seed(ringAround(circleCells(BERLIN), 1));
    const centre = tileOf(BERLIN.lat, BERLIN.lon);
    const world = await exploredAnswer(userId, { west: -180, south: -85, east: 180, north: 85 });
    const tiny = { west: 13.404, south: 52.519, east: 13.406, north: 52.521 };

    const { cells } = await exploredAnswer(userId, tiny);

    expect(cells).toEqual([centre]);
    expect(world.cells.map(key)).toContain(key(centre));
  });

  it("many former zones: an empty tiny box costs a fixed handful of queries", async () => {
    const tombstones = Array.from({ length: 400 }, (_, i) => ({
      userId,
      lat: 40 + (i % 20) * 0.2,
      lon: 5 + Math.floor(i / 20) * 0.2,
      radiusM: 5_000,
      untilAt: new Date(Date.parse("2026-10-01T00:00:00Z") + i * 60_000),
    }));
    await prisma.travTrackZoneTombstone.createMany({ data: tombstones });
    await prisma.$transaction((tx) => rebuildZoneCells(tx, userId));
    expect(await prisma.travTrackZoneCell.count({ where: { userId } })).toBeGreaterThan(0);

    let queries = 0;
    const stop = observeQueries(() => {
      queries += 1;
    });
    const started = Date.now();
    try {
      const { cells } = await exploredAnswer(userId, {
        west: -60.001,
        south: -30.001,
        east: -60,
        north: -30,
      });
      expect(cells).toEqual([]);
    } finally {
      stop();
    }
    expect(queries).toBeLessThanOrEqual(4);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("a 20 km zone and 200 former zones are decided within a fixed time budget (security review)", async () => {
    const big = { lat: 52.52, lon: 13.405, radiusM: 20_000 };
    await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Gross", ...big } });
    await prisma.travTrackZoneTombstone.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        userId,
        lat: 50 + (i % 20) * 0.15,
        lon: 8 + Math.floor(i / 20) * 0.15,
        radiusM: 5_000,
        untilAt: new Date(Date.parse("2026-10-01T00:00:00Z") + i * 60_000),
      })),
    });
    const bigCells = circleCells(big);
    await seed(ringAround(bigCells, 2));

    const built = Date.now();
    await prisma.$transaction((tx) => rebuildZoneCells(tx, userId), { timeout: 30_000 });
    expect(Date.now() - built).toBeLessThan(5_000);

    const asked = Date.now();
    const { cells } = await exploredAnswer(userId, { west: 12, south: 52, east: 15, north: 53 });
    expect(Date.now() - asked).toBeLessThan(2_000);
    const drawn = new Set(cells.map(key));
    for (const c of bigCells) expect(drawn.has(key(c))).toBe(true);
  });

  it("more raster cells than the cap fail closed: no zone cell is drawn, not a partial fill", async () => {
    const huge = { lat: 52.52, lon: 13.405, radiusM: 250_000 };
    expect(circleCells(huge).length).toBeGreaterThan(MAX_ZONE_CELLS);
    await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Riesig", ...huge } });
    const centre = tileOf(52.52, 13.405);
    await seed([
      { x: centre.x - 1, y: centre.y },
      { x: centre.x + 1, y: centre.y },
      { x: centre.x, y: centre.y - 1 },
      { x: centre.x, y: centre.y + 1 },
    ]);
    await prisma.$transaction((tx) => rebuildZoneCells(tx, userId), { timeout: 30_000 });

    expect(await prisma.travTrackZoneCell.count({ where: { userId } })).toBe(0);
    const { cells } = await exploredAnswer(userId, {
      west: 13.3,
      south: 52.45,
      east: 13.5,
      north: 52.6,
    });
    expect(cells.map(key)).not.toContain(key(centre));
    expect(cells).toHaveLength(4);
  });

  it("only the newest former circles are rasterised, and one inside another adds nothing", async () => {
    const base = Date.parse("2026-10-01T00:00:00Z");
    await prisma.travTrackZoneTombstone.createMany({
      data: [
        // The same circle many times over: one circle's cells.
        ...Array.from({ length: 30 }, (_, i) => ({
          userId,
          ...BERLIN,
          untilAt: new Date(base + i * 60_000),
        })),
        // One inside it.
        { userId, lat: 52.52, lon: 13.405, radiusM: 500, untilAt: new Date(base) },
      ],
    });
    await prisma.$transaction((tx) => rebuildZoneCells(tx, userId));
    expect((await stored()).length).toBe(circleCells(BERLIN).length);
    expect(MAX_FORMER_CIRCLES).toBeGreaterThanOrEqual(50);
  });
});
