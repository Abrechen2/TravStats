import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { COUNTRY_DAYS_BIT, MONTHS_BIT, markTravTrackDaysDirty } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import type { StoredPoint } from "../../../tripRecording/segments";
import { cityCellOf, dwellCells } from "../cities";
import { projectMonths } from "../project";
import { setTravTrackCityLookup } from "../read";

/**
 * The cities of the monthly values (TravTrack plan L3, review focus 27): off
 * by default and then null, with no geocoder call; on, one lookup per rounded
 * cell for every account, never for a dwell inside a privacy circle, and the
 * cache holds no user.
 */

const PREFIX = "travtrack-months-cities-";
const D1 = "2026-10-12";
const OCT = "2026-10-01";
const at = (day: string, time: string) => Date.parse(`${day}T${time}Z`);
const SEOUL = { lat: 37.5665, lon: 126.978 };
const SEOUL_NEAR = { lat: 37.5671, lon: 126.9786 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };
const CELLS = ["37.57,126.98", "35.18,129.08"];

const ok = (city: string) => ({ parts: { city }, degraded: false });

describe("monthly values — cities", () => {
  const switches = travTrackSwitches();
  let userId: string;
  const geocode = jest.fn(async (lat: number, _lon: number) => ok(lat > 36 ? "Seoul" : "Busan"));
  const countryAt = () => "KR";

  const dirty = async (owner = userId) => {
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, owner, [D1]));
    await prisma.$executeRaw`UPDATE travtrack_dirty_days SET done = done | ${COUNTRY_DAYS_BIT}
                              WHERE user_id = ${owner}`;
  };
  /** 40 minutes at one place, a fix every ten. */
  const dwell = async (start: string, p: { lat: number; lon: number }, owner = userId) => {
    const t0 = at(D1, start);
    for (let i = 0; i <= 4; i++) await storePoint(owner, { t: t0 + i * 600_000, ...p });
  };
  const month = (owner = userId) =>
    prisma.travTrackMonthValue.findUnique({
      where: { userId_month: { userId: owner, month: utcMidnight(OCT) } },
    });
  const run = (owner = userId, now = new Date("2026-10-25T12:00:00Z")) =>
    projectMonths(owner, { geocode, countryAt, cityIntervalMs: 0, now });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    geocode.mockClear();
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.travTrackMonthValue.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.userSettings.updateMany({
      where: { userId },
      data: { travtrackCityLookup: false },
    });
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: CELLS } } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: CELLS } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("off by default → cities null, no geocoder call", async () => {
    await dwell("03:00:00", SEOUL);
    await dirty();

    expect(await run()).toMatchObject({ projected: 1, lookups: 0 });

    expect((await month())!.cities).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });

  it("on: one lookup per rounded cell, its centre only, and the cities by name", async () => {
    await setTravTrackCityLookup(userId, true);
    await dwell("03:00:00", SEOUL);
    await dwell("05:00:00", SEOUL_NEAR);
    await dwell("09:00:00", BUSAN);
    await dirty();

    expect(await run()).toMatchObject({ projected: 1, lookups: 2 });

    expect(geocode.mock.calls.map(([lat, lon]) => [lat, lon]).sort()).toEqual([
      [35.18, 129.08],
      [37.57, 126.98],
    ]);
    expect((await month())!.cities).toEqual([
      { name: "Busan", countryCode: "KR" },
      { name: "Seoul", countryCode: "KR" },
    ]);
    const days = await prisma.travTrackDirtyDay.findFirstOrThrow({ where: { userId } });
    expect(days.done & MONTHS_BIT).toBe(MONTHS_BIT);

    // Cached for every account: a second account in the same cell asks nobody.
    const otherId = await makeUser(`${PREFIX}b`);
    await setLocationProvider(otherId, "travtrack");
    await setTravTrackCityLookup(otherId, true);
    await dwell("03:00:00", SEOUL, otherId);
    await dirty(otherId);
    geocode.mockClear();
    expect(await run(otherId)).toMatchObject({ projected: 1, lookups: 0 });
    expect((await month(otherId))!.cities).toEqual([{ name: "Seoul", countryCode: "KR" }]);
    await wipeTravTrack([otherId]);
  });

  it("never looks up a dwell inside a privacy zone", async () => {
    await setTravTrackCityLookup(userId, true);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", ...BUSAN, radiusM: 1_000 },
    });
    await dwell("03:00:00", SEOUL);
    // Stored before the zone existed — the read cuts it all the same.
    await dwell("09:00:00", BUSAN);
    await dirty();

    await run();

    expect(geocode.mock.calls.map(([lat]) => lat)).toEqual([37.57]);
    expect((await month())!.cities).toEqual([{ name: "Seoul", countryCode: "KR" }]);
  });

  it("a failed lookup leaves the cities null, the month owed and nothing cached", async () => {
    await setTravTrackCityLookup(userId, true);
    await dwell("03:00:00", SEOUL);
    await dirty();
    geocode.mockImplementationOnce(async () => ({ parts: null, degraded: true }) as never);

    expect(await run()).toMatchObject({ projected: 0, rerun: 1, lookups: 1 });
    expect((await month())!.cities).toBeNull();
    const days = await prisma.travTrackDirtyDay.findFirstOrThrow({ where: { userId } });
    expect(days.done & MONTHS_BIT).toBe(0);
    expect(await prisma.geoCityCache.count({ where: { cell: { in: CELLS } } })).toBe(0);

    // Backed off: the next attempt waits (lookup.test.ts), then succeeds.
    expect(await run(userId, new Date("2026-10-26T12:00:00Z"))).toMatchObject({ projected: 1 });
    expect((await month())!.cities).toEqual([{ name: "Seoul", countryCode: "KR" }]);
  });

  it("an answer without a settlement is cached and names no city", async () => {
    await setTravTrackCityLookup(userId, true);
    await dwell("03:00:00", SEOUL);
    await dirty();
    geocode.mockImplementationOnce(async () => ({ parts: null, degraded: false }) as never);

    await run();

    expect((await month())!.cities).toEqual([]);
    expect(await prisma.geoCityCache.findUnique({ where: { cell: CELLS[0] } })).toMatchObject({
      name: null,
    });
  });

  it("the city cache holds no user id, no time of a stay and no track", async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'geo_city_cache' ORDER BY column_name`;
    expect(columns.map((c) => c.column_name)).toEqual([
      "cell",
      "country_code",
      "fetched_at",
      "name",
    ]);
  });
});

describe("dwellCells", () => {
  const p = (min: number, lat: number, lon: number): StoredPoint => [min * 60_000, lat, lon, 5];
  const ground = () => false;

  it("a dwell is 30 minutes within 250 m; 29 minutes is none", () => {
    expect(dwellCells([[p(0, 52.52, 13.405), p(30, 52.521, 13.405)]], [], ground)).toEqual([
      cityCellOf(52.5205, 13.405),
    ]);
    expect(dwellCells([[p(0, 52.52, 13.405), p(29, 52.521, 13.405)]], [], ground)).toEqual([]);
  });

  it("moving on ends a dwell", () => {
    // 600 m apart after 40 minutes: two places, neither held 30 minutes.
    expect(dwellCells([[p(0, 52.52, 13.405), p(40, 52.5254, 13.405)]], [], ground)).toEqual([]);
  });

  it("no dwell whose cell centre lies in a circle, even when the dwell does not", () => {
    // 365 m from the centre of a 300 m zone, so outside it — but the dwell's
    // rounded cell is the zone's centre, and only that centre is ever sent.
    const zone = { lat: 52.52, lon: 13.4, radiusM: 300 };
    const stretch = [p(0, 52.5225, 13.4035), p(40, 52.5225, 13.4035)];
    expect(cityCellOf(52.5225, 13.4035)).toEqual({ cell: "52.52,13.40", lat: 52.52, lon: 13.4 });
    expect(dwellCells([stretch], [], ground)).toHaveLength(1);
    expect(dwellCells([stretch], [zone], ground)).toEqual([]);
  });

  it("an airborne point is no dwell", () => {
    const stretch = [p(0, 52.52, 13.405), p(40, 52.52, 13.405)];
    expect(dwellCells([stretch], [], () => true)).toEqual([]);
  });
});
