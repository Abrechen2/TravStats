import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { createZone } from "../../zones";
import { makeUser, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import type { Cell } from "../cells";
import { circleCells, exploredAnswer } from "../privacy";
import { addZoneCircle } from "../zoneCells";

/**
 * One explored-map answer reads one snapshot (Codex re-review of L1): the
 * raster state, the box's cells, the zones touching the box and their
 * neighbours are read in one repeatable-read transaction, so a zone write
 * committing between those reads can neither punch a hole into the answer
 * nor slip an overflow past the refusal.
 */

const PREFIX = "travtrack-explored-snapshot-";
const BERLIN = { lat: 52.52, lon: 13.405, radiusM: 3_000 };
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

describe("the explored map's snapshot", () => {
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
    await createZone(userId, { name: "Zuhause", ...BERLIN }, true);
    await prisma.travTrackExploredCell.createMany({
      data: ringAround(circleCells(BERLIN)).map((c) => ({
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

  it("an overflow committed between the reads cannot turn into an answer with holes", async () => {
    const before = await exploredAnswer(userId, BOX);
    const zone = new Set(circleCells(BERLIN).map(key));
    expect(before.cells.filter((c) => zone.has(key(c)))).toHaveLength(zone.size);

    // Between the first read and the rest, another request marks the account
    // over the cap — which deletes the raster.
    const during = await exploredAnswer(userId, BOX, {
      betweenReads: () =>
        prisma.$transaction((tx) =>
          addZoneCircle(tx, userId, { lat: 48.137, lon: 11.575, radiusM: 3_000 }, 0)
        ),
    });

    // The answer is the one consistent before the write — zone filled, no hole.
    expect(during).toEqual(before);
    // And the next one refuses whole.
    await expect(exploredAnswer(userId, BOX)).rejects.toMatchObject({
      code: "TRAVTRACK_EXPLORED_UNAVAILABLE",
    });
  });

  it("a zone write merging components between the reads leaves the answer whole", async () => {
    const before = await exploredAnswer(userId, BOX);
    const during = await exploredAnswer(userId, BOX, {
      betweenReads: async () => {
        await createZone(userId, { name: "Nachbar", lat: 52.52, lon: 13.46, radiusM: 3_000 }, true);
      },
    });
    expect(during).toEqual(before);
  });
});
