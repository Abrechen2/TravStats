import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { makeUser, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import type { Cell } from "../cells";
import { circleCells, exploredAnswer } from "../privacy";
import { buildPendingZoneRasters, buildZoneRasterStep } from "../zoneCells";
import * as raster from "../zoneRaster";

/**
 * The zone raster is strictly incremental (Codex re-review of L1): a zone
 * write adds its circle once, at write time, and a map request never
 * rasterises anything. An account whose raster was never built — zones and
 * former zones from before the explored map — is built by a bounded
 * background job, a slice of former circles per tick, and its map answers
 * 409 TRAVTRACK_EXPLORED_PREPARING until the build is done.
 */

const PREFIX = "travtrack-explored-build-";
const OLDEST = { lat: 52.52, lon: 13.405, radiusM: 2_000 };
const BOX = { west: 13.3, south: 52.45, east: 13.5, north: 52.6 };
const key = (c: Cell) => `${c.x}/${c.y}`;

function ringAround(cells: readonly Cell[]): Cell[] {
  const inner = new Set(cells.map(key));
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const out: Cell[] = [];
  for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x++) {
    for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
      if (!inner.has(`${x}/${y}`)) out.push({ x, y });
    }
  }
  return out;
}

describe("the zone raster's background build", () => {
  const switches = travTrackSwitches();
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackExploredCell.deleteMany({ where: { userId } });
    await prisma.travTrackZoneCell.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    // 1,000 historic moves, the oldest one in Berlin, and the zone where it is now.
    const base = Date.parse("2026-01-01T00:00:00Z");
    await prisma.travTrackZoneTombstone.createMany({
      data: [
        { userId, ...OLDEST, untilAt: new Date(base) },
        ...Array.from({ length: 999 }, (_, i) => ({
          userId,
          lat: 40 + (i % 30) * 0.05,
          lon: 0 + Math.floor(i / 30) * 0.05,
          radiusM: 1_000,
          untilAt: new Date(base + (i + 1) * 60_000),
        })),
      ],
    });
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Jetzt", lat: 41, lon: 1, radiusM: 1_000 },
    });
    await prisma.travTrackExploredCell.createMany({
      data: ringAround(circleCells(OLDEST)).map((c) => ({
        userId,
        day: utcMidnight("2026-10-12"),
        ...c,
      })),
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a read with 1,000 historic moves does no rasterisation and answers 'preparing'", async () => {
    const spy = jest.spyOn(raster, "circleCells");
    try {
      await expect(exploredAnswer(userId, BOX)).rejects.toMatchObject({
        statusCode: 409,
        code: "TRAVTRACK_EXPLORED_PREPARING",
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.travTrackZoneCell.count({ where: { userId } })).toBe(0);
  });

  it("the background build works in bounded slices, then the map answers with every former zone", async () => {
    const spy = jest.spyOn(raster, "circleCells");
    let steps = 0;
    try {
      for (;;) {
        spy.mockClear();
        const step = await buildZoneRasterStep(userId, 100);
        steps += 1;
        // One slice: the zones in force on the first step, then at most 100 former circles.
        expect(spy.mock.calls.length).toBeLessThanOrEqual(101);
        if (step === "done") break;
        expect(steps).toBeLessThan(20);
      }
    } finally {
      spy.mockRestore();
    }
    expect(steps).toBe(11);
    const { cells } = await exploredAnswer(userId, BOX);
    const drawn = new Set(cells.map(key));
    for (const c of circleCells(OLDEST)) expect(drawn.has(key(c))).toBe(true);
  });

  it("the scheduler's pass builds pending accounts a slice at a time", async () => {
    await buildPendingZoneRasters({ maxAccounts: 50, maxCircles: 400 });
    await expect(exploredAnswer(userId, BOX)).rejects.toMatchObject({
      code: "TRAVTRACK_EXPLORED_PREPARING",
    });
    for (let i = 0; i < 3; i++) await buildPendingZoneRasters({ maxAccounts: 50, maxCircles: 400 });
    await expect(exploredAnswer(userId, BOX)).resolves.toBeTruthy();
  });

  it("an account with no zone and no former zone is ready at once, without a build", async () => {
    await prisma.travTrackZoneTombstone.deleteMany({ where: { userId } });
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    const { cells } = await exploredAnswer(userId, BOX);
    expect(cells.length).toBeGreaterThan(0);
  });
});
