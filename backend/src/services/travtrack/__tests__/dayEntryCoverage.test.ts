import { prisma } from "../../../db";
import { fillWithEntries, explainingEntries } from "../dayEntryCoverage";
import type { DayContextEntry } from "../dayContext";
import { travTrackDay } from "../dayView";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * A silence the logbook explains: the coverage band names the flight / night
 * instead of "no data", only where nothing was recorded, and draws nothing.
 */

const PREFIX = "travtrack-day-entry-";
const H = 3_600_000;
const MIN = 60_000;
// 12 Oct in Berlin (UTC+2) runs from 11 Oct 22:00Z to 12 Oct 22:00Z.
const DAY = "2026-10-12";
const D0 = Date.parse("2026-10-11T22:00:00Z");
const at = (iso: string) => Date.parse(iso);

describe("TravTrack — a silence a logbook entry explains", () => {
  let userId: string;

  const settings = async (enabledDomains: string[]) => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Europe/Berlin" } }, enabledDomains },
    });
  };

  const flight = (dep: string, arr: string, flightNumber = "LH1") =>
    prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        arrIata: "LIS",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 38.77,
        arrLon: -9.13,
        flightNumber,
        departureTime: new Date(dep),
        arrivalTime: new Date(arr),
        status: "flown",
      },
    });

  /** Frankfurt in the morning, Lisbon in the evening: far-apart ends, nothing in between. */
  const flightDayPoints = async () => {
    await storePoint(userId, { t: at("2026-10-12T05:00:00Z"), lat: 50.03, lon: 8.57 });
    await storePoint(userId, { t: at("2026-10-12T05:05:00Z"), lat: 50.031, lon: 8.571 });
    await storePoint(userId, { t: at("2026-10-12T14:00:00Z"), lat: 38.77, lon: -9.13 });
    await storePoint(userId, { t: at("2026-10-12T14:05:00Z"), lat: 38.771, lon: -9.131 });
  };

  const states = async () => (await travTrackDay(userId, DAY)).coverage;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await settings(["flight", "lodging"]);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a flight across a noData stretch is entry with the flight's id, not noData", async () => {
    const f = await flight("2026-10-12T08:00:00Z", "2026-10-12T11:00:00Z");
    await flightDayPoints();
    const coverage = await states();
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T08:00:00Z"),
      untilMs: at("2026-10-12T11:00:00Z"),
      state: "entry",
      entry: { domain: "flight", id: f.id },
    });
    // The rest of the silence is still no data.
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T05:05:00Z"),
      untilMs: at("2026-10-12T08:00:00Z"),
      state: "noData",
    });
    const overlapped = coverage.filter(
      (c) =>
        c.state === "noData" &&
        c.fromMs < at("2026-10-12T11:00:00Z") &&
        c.untilMs > at("2026-10-12T08:00:00Z")
    );
    expect(overlapped).toEqual([]);
  });

  it("a lodging night over a silence with far-apart ends is entry", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Krone", lat: 38.77, lon: -9.13 },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkInAt: new Date("2026-10-12T05:30:00Z"),
        checkOutAt: new Date("2026-10-12T13:00:00Z"),
      },
    });
    await flightDayPoints();
    const coverage = await states();
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T05:30:00Z"),
      untilMs: at("2026-10-12T13:00:00Z"),
      state: "entry",
      entry: { domain: "lodging", id: stay.id },
    });
  });

  it("a gap with no entry stays noData", async () => {
    await flightDayPoints();
    const coverage = await states();
    expect(coverage.some((c) => c.state === "entry")).toBe(false);
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T05:05:00Z"),
      untilMs: at("2026-10-12T14:00:00Z"),
      state: "noData",
    });
  });

  it("recorded time under an entry stays recorded", async () => {
    await flight("2026-10-12T04:00:00Z", "2026-10-12T15:00:00Z");
    await flightDayPoints();
    const coverage = await states();
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T05:00:00Z"),
      untilMs: at("2026-10-12T05:05:00Z"),
      state: "recorded",
    });
    expect(coverage).toContainEqual({
      fromMs: at("2026-10-12T14:00:00Z"),
      untilMs: at("2026-10-12T14:05:00Z"),
      state: "recorded",
    });
  });

  it("an entry of a domain the account does not show does not fill", async () => {
    await settings(["lodging"]);
    await flight("2026-10-12T08:00:00Z", "2026-10-12T11:00:00Z");
    await flightDayPoints();
    expect((await states()).some((c) => c.state === "entry")).toBe(false);
  });

  it("an entry adds no point, no leg and no distance", async () => {
    await flightDayPoints();
    const before = await travTrackDay(userId, DAY);
    await flight("2026-10-12T08:00:00Z", "2026-10-12T11:00:00Z");
    const after = await travTrackDay(userId, DAY);
    expect(after.segments).toEqual(before.segments);
    expect(after.pointCount).toBe(before.pointCount);
    expect(after.legs).toEqual(before.legs);
    expect(after.stops).toEqual(before.stops);
  });

  describe("fillWithEntries", () => {
    const gap = [{ fromMs: D0, untilMs: D0 + 10 * H, state: "noData" }];
    it("overlapping entries: the earlier-starting one, then the smaller id", () => {
      const out = fillWithEntries(gap, [
        { fromMs: D0 + H, untilMs: D0 + 5 * H, domain: "rail", id: "a" },
        { fromMs: D0 + 2 * H, untilMs: D0 + 8 * H, domain: "bus", id: "b" },
        { fromMs: D0 + 2 * H, untilMs: D0 + 3 * H, domain: "ferry", id: "0" },
      ]);
      expect(out.map((p) => [p.fromMs - D0, p.untilMs - D0, p.state, p.entry?.id])).toEqual([
        [0, H, "noData", undefined],
        [H, 5 * H, "entry", "a"],
        [5 * H, 8 * H, "entry", "b"],
        [8 * H, 10 * H, "noData", undefined],
      ]);
    });
    it("an entry without a window explains nothing", () => {
      const e = (fromMs: number, untilMs: number) =>
        ({
          kind: "flight",
          id: "x",
          fromMs,
          untilMs,
          label: "",
          href: null,
          anchor: null,
          unlabelled: false,
        }) as DayContextEntry;
      expect(explainingEntries([e(D0, D0), e(D0 + 5, D0 + 1)])).toEqual([]);
      expect(fillWithEntries(gap, [])).toEqual(gap);
    });
  });
});
