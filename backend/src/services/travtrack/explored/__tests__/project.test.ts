import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { deleteTravTrackRange } from "../../deleteRange";
import { COUNTRY_DAYS_BIT, EXPLORED_BIT, markTravTrackDaysDirty } from "../../dirtyDays";
import { makeFlight, makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { tileOf } from "../cells";
import { projectExploredCells } from "../project";

/**
 * The explored map's projection (TravTrack plan L1, review focus 28): E6's
 * dirty-day protocol with its own `done` bit — one day per transaction under
 * the TravTrack lock, cells from the derivation read (masked and in-flight
 * points explore nothing), acknowledged only for the version read; a removal
 * deletes its days' cells in its own transaction and the next run rebuilds
 * them from what is left.
 */

const PREFIX = "travtrack-explored-project-";
const D1 = "2026-10-12";
const D2 = "2026-10-13";
const at = (day: string, time: string) => Date.parse(`${day}T${time}Z`);
const SEOUL = { lat: 37.5665, lon: 126.978 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };

describe("projectExploredCells", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const dirty = (days: string[]) =>
    prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, days));
  const cells = () =>
    prisma.travTrackExploredCell.findMany({
      where: { userId },
      orderBy: [{ day: "asc" }, { x: "asc" }, { y: "asc" }],
      select: { day: true, x: true, y: true },
    });
  const dirtyRow = (day: string) =>
    prisma.travTrackDirtyDay.findUniqueOrThrow({
      where: { userId_day: { userId, day: utcMidnight(day) } },
    });
  const store = (t: number, p: { lat: number; lon: number }) => storePoint(userId, { t, ...p });
  const cell = (day: string, p: { lat: number; lon: number }) => ({
    day: utcMidnight(day),
    ...tileOf(p.lat, p.lon),
  });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.travTrackExploredCell.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a day's points become its cells once, acked on its own bit", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await store(at(D1, "03:05:00"), { lat: 37.5666, lon: 126.9781 });
    await store(at(D1, "09:00:00"), BUSAN);
    await dirty([D1]);

    const result = await projectExploredCells(userId);

    expect(result).toMatchObject({ status: "done", projected: 1, rerun: 0 });
    expect(await cells()).toEqual(
      [cell(D1, SEOUL), cell(D1, BUSAN)].sort((a, b) => a.x - b.x || a.y - b.y)
    );
    const row = await dirtyRow(D1);
    expect(row.done & EXPLORED_BIT).toBe(EXPLORED_BIT);
    // The country projection's bit is its own: still owed.
    expect(row.done & COUNTRY_DAYS_BIT).toBe(0);

    // Acked: a second run has nothing to do and writes nothing twice.
    expect(await projectExploredCells(userId)).toMatchObject({ projected: 0 });
    expect(await cells()).toHaveLength(2);
  });

  it("a point stored during the projection re-marks the day and it runs again", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);

    const first = await projectExploredCells(userId, {
      beforeAck: async () => {
        await store(at(D1, "04:00:00"), BUSAN);
        await dirty([D1]);
      },
    });
    expect(first).toMatchObject({ projected: 0, rerun: 1 });
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);

    expect(await projectExploredCells(userId)).toMatchObject({ projected: 1 });
    expect(await cells()).toHaveLength(2);
  });

  it("deleting a day's range removes its cells and keeps the cells other days explored", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await store(at(D1, "09:00:00"), BUSAN);
    await store(at(D2, "12:00:00"), SEOUL);
    await dirty([D1, D2]);
    await projectExploredCells(userId);
    expect(await cells()).toHaveLength(3);

    await deleteTravTrackRange(userId, new Date(at(D1, "08:00:00")), new Date(at(D1, "10:00:00")));

    // Gone with the delete, in its transaction (D1 and its neighbour D2 read
    // each other as context, so both go and both re-derive).
    expect(await cells()).toEqual([]);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);

    await projectExploredCells(userId);
    expect(await cells()).toEqual(
      [cell(D1, SEOUL), cell(D2, SEOUL)].sort((a, b) => +a.day - +b.day)
    );
  });

  it("a rolled-back delete leaves the cells as they were", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);
    await projectExploredCells(userId);
    const before = await cells();

    await expect(
      prisma.$transaction(async (tx) => {
        await deleteTravTrackRange(
          userId,
          new Date(at(D1, "00:00:00")),
          new Date(at(D2, "00:00:00")),
          tx
        );
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");

    expect(await cells()).toEqual(before);
  });

  it("airborne and masked points explore nothing", async () => {
    // The fixture flight is in the air 2026-10-12 00:30–01:30Z, ICN → CJU.
    await makeFlight(userId);
    await store(at(D1, "00:45:00"), { lat: 35.5, lon: 126.7 });
    await store(at(D1, "01:15:00"), { lat: 34.0, lon: 126.5 });
    // A stale fix from Tokyo for eight minutes inside a morning in Seoul.
    for (const time of ["10:00:00", "10:10:00", "10:20:00"]) await store(at(D1, time), SEOUL);
    await store(at(D1, "10:24:00"), { lat: 35.6762, lon: 139.6503 });
    await store(at(D1, "10:28:00"), { lat: 35.6762, lon: 139.6503 });
    for (const time of ["10:30:00", "10:40:00", "10:50:00"]) await store(at(D1, time), SEOUL);
    await dirty([D1]);

    await projectExploredCells(userId);

    expect(await cells()).toEqual([cell(D1, SEOUL)]);
  });

  it("the window is half-open: a point at 00:00:00Z belongs to the next day", async () => {
    await store(at(D2, "00:00:00"), SEOUL);
    await dirty([D1, D2]);

    await projectExploredCells(userId);

    expect(await cells()).toEqual([cell(D2, SEOUL)]);
  });

  it("a day larger than one read is paged to its end: every cell, none partial", async () => {
    const stops = [SEOUL, BUSAN, { lat: 36.35, lon: 127.38 }, { lat: 35.87, lon: 128.6 }];
    // Two fixes per stop, an hour apart: plausible travel, nothing masked.
    for (const [i, p] of stops.entries()) {
      await store(at(D1, `0${2 * i}:00:00`), p);
      await store(at(D1, `0${2 * i}:10:00`), p);
    }
    await dirty([D1]);

    await projectExploredCells(userId, { maxPoints: 2 });

    expect(await cells()).toHaveLength(4);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(EXPLORED_BIT);
  });

  it("TravTrack switched off while the day waits for the lock: nothing is written or acked (Codex review)", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);

    const result = await projectExploredCells(userId, {
      afterLock: async () => switches.set({ beta: true, config: false }),
    });

    expect(result).toMatchObject({ status: "disabled", projected: 0 });
    expect(await cells()).toEqual([]);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);
  });

  it("TravTrack switched off between the replace and the ack: the day rolls back", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);

    const result = await projectExploredCells(userId, {
      beforeAck: async () => switches.set({ beta: true, config: false }),
    });

    expect(result).toMatchObject({ status: "disabled", projected: 0 });
    expect(await cells()).toEqual([]);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);
  });

  it("TravTrack off → nothing runs and the dirty days wait", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);
    await switches.set({ beta: true, config: false });

    expect(await projectExploredCells(userId)).toMatchObject({ status: "disabled", projected: 0 });
    expect(await cells()).toEqual([]);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);
  });

  it("an account whose provider is not TravTrack is skipped and keeps its cells", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);
    await projectExploredCells(userId);
    await store(at(D1, "04:00:00"), BUSAN);
    await dirty([D1]);
    await setLocationProvider(userId, "none");

    expect(await projectExploredCells(userId)).toMatchObject({ status: "skipped" });
    expect(await cells()).toEqual([cell(D1, SEOUL)]);
  });

  it("a failed day leaves its old cells and its dirty mark", async () => {
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);
    await projectExploredCells(userId);
    await store(at(D1, "04:00:00"), BUSAN);
    await dirty([D1]);

    const failed = await projectExploredCells(userId, {
      beforeAck: async () => {
        throw new Error("connection lost");
      },
    });

    expect(failed).toMatchObject({ status: "failed", projected: 0 });
    expect(await cells()).toEqual([cell(D1, SEOUL)]);
    expect((await dirtyRow(D1)).done & EXPLORED_BIT).toBe(0);
  });

  it("only this account's points become its cells", async () => {
    const otherId = await makeUser(`${PREFIX}b`);
    await storePoint(otherId, { t: at(D1, "03:00:00"), ...BUSAN });
    await store(at(D1, "03:00:00"), SEOUL);
    await dirty([D1]);

    await projectExploredCells(userId);

    expect(await cells()).toEqual([cell(D1, SEOUL)]);
    expect(await prisma.travTrackExploredCell.count({ where: { userId: otherId } })).toBe(0);
    await wipeTravTrack([otherId]);
  });
});
