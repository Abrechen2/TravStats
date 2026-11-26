import { prisma } from "../../../db";
import { markTravTrackDaysDirty } from "../../travtrack/dirtyDays";
import {
  clearWrappedTravTrackCache,
  persistedYearFigures,
  travTrackYearFingerprint,
} from "../wrappedTravTrackCache";

/**
 * Perf audit 2026-11, item 9: every Companion upload raised max(seq) and so
 * invalidated every year's TravTrack figures, and the cache was an in-memory
 * map lost on every deploy. A year is now keyed on its own days and kept in
 * travtrack_year_summaries.
 */
const USERNAME = "year-summary-user";
let userId = "";
const Y2024 = {
  fromMs: Date.parse("2024-01-01T00:00:00Z"),
  untilMs: Date.parse("2025-01-01T00:00:00Z"),
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  userId = (await prisma.user.create({ data: { username: USERNAME, passwordHash: "x" } })).id;
  await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, ["2024-05-01"]));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
});

describe("the per-year TravTrack summary", () => {
  it("keeps a past year's fingerprint when an upload touches only today", async () => {
    const before = await travTrackYearFingerprint(userId, "UTC", Y2024);
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, ["2026-11-26"]));
    expect(await travTrackYearFingerprint(userId, "UTC", Y2024)).toBe(before);
  });

  it("moves when a point of that year is stored or removed", async () => {
    const before = await travTrackYearFingerprint(userId, "UTC", Y2024);
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, ["2024-05-01"]));
    expect(await travTrackYearFingerprint(userId, "UTC", Y2024)).not.toBe(before);
  });

  it("serves the stored figures after a restart without recomputing", async () => {
    const fp = await travTrackYearFingerprint(userId, "UTC", Y2024);
    const compute = jest.fn().mockResolvedValue({ kmGround: 12.5 });
    expect(await persistedYearFigures(userId, 2024, fp, compute)).toEqual({ kmGround: 12.5 });
    clearWrappedTravTrackCache(); // what a deploy does to the in-memory map
    const again = jest.fn();
    expect(await persistedYearFigures(userId, 2024, fp, again)).toEqual({ kmGround: 12.5 });
    expect(again).not.toHaveBeenCalled();
  });

  it("recomputes and stores when the fingerprint moved, null included", async () => {
    const compute = jest.fn().mockResolvedValue(null);
    expect(await persistedYearFigures(userId, 2024, "other", compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
    const row = await prisma.travTrackYearSummary.findUnique({
      where: { userId_year: { userId, year: 2024 } },
    });
    expect(row).toMatchObject({ fingerprint: "other", value: { v: null } });
  });
});
