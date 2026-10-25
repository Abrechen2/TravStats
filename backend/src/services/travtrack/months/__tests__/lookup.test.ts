import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { deleteTravTrackRange } from "../../deleteRange";
import { COUNTRY_DAYS_BIT, MONTHS_BIT, markTravTrackDaysDirty } from "../../dirtyDays";
import { createZone } from "../../zones";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { retryAfterMs } from "../../../geo/nominatim";
import { lookUpCityCells } from "../cities";
import { cityBackoffMs } from "../lookup";
import { projectMonths } from "../project";
import { setTravTrackCityLookup } from "../read";

/**
 * What may still leave the server while a month's cells are looked up
 * (TravTrack plan L3, security review of c89c64d16): every request is
 * preceded by the switch, the allowance, the history generation and the
 * zones as they are NOW; a failing geocoder backs the account off.
 */

const PREFIX = "travtrack-months-lookup-";
const D1 = "2026-10-12";
const at = (time: string) => Date.parse(`${D1}T${time}Z`);
const NOW = new Date("2026-10-25T12:00:00Z");
const PLACES = [
  { lat: 37.5665, lon: 126.978 },
  { lat: 35.1796, lon: 129.0756 },
  { lat: 35.8714, lon: 128.6014 },
];
const CELLS = ["37.57,126.98", "35.18,129.08", "35.87,128.60"];

const ok = { parts: { city: "Somewhere" }, degraded: false };

describe("monthly values — what a city lookup may still send", () => {
  const switches = travTrackSwitches();
  let userId: string;
  const geocode = jest.fn(async (_lat: number, _lon: number) => ok as never);
  const countryAt = () => "KR";
  const run = (now = NOW) => projectMonths(userId, { geocode, countryAt, cityIntervalMs: 0, now });
  const sent = () => geocode.mock.calls.map(([lat, lon]) => `${lat.toFixed(2)},${lon.toFixed(2)}`);
  const state = () => prisma.travTrackDerivationState.findUnique({ where: { userId } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    geocode.mockReset();
    geocode.mockImplementation(async () => ok as never);
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.travTrackMonthValue.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: CELLS } } });
    await setTravTrackCityLookup(userId, true);
    // Three dwells of 40 minutes, three cells.
    for (const [k, p] of PLACES.entries()) {
      const t0 = at(`0${2 * k + 1}:00:00`);
      for (let i = 0; i <= 4; i++) await storePoint(userId, { t: t0 + i * 600_000, ...p });
    }
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [D1]));
    await prisma.$executeRaw`UPDATE travtrack_dirty_days SET done = done | ${COUNTRY_DAYS_BIT}
                              WHERE user_id = ${userId}`;
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: CELLS } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("switched off between two lookups: no further request", async () => {
    geocode.mockImplementationOnce(async () => {
      await setTravTrackCityLookup(userId, false);
      return ok as never;
    });
    await run();
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("TravTrack switched off between two lookups: no further request", async () => {
    geocode.mockImplementationOnce(async () => {
      await switches.set({ beta: true, config: false });
      return ok as never;
    });
    await run();
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("a zone added mid-batch: its cell is never sent, nor anything after it", async () => {
    geocode.mockImplementationOnce(async () => {
      await createZone(userId, { name: "Z", ...PLACES[2], radiusM: 50 }, true);
      return ok as never;
    });
    await run();
    expect(sent()).not.toContain(CELLS[2]);
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("history deleted mid-batch: no further request", async () => {
    geocode.mockImplementationOnce(async () => {
      await deleteTravTrackRange(userId, new Date(at("04:30:00")), new Date(at("06:00:00")));
      return ok as never;
    });
    await run();
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("a failing geocoder backs the account off, doubling, and an answer resets it", async () => {
    geocode.mockImplementation(async () => ({ parts: null, degraded: true }) as never);
    await run();
    // The batch ends at the first failure.
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(await state()).toMatchObject({
      cityLookupFailures: 1,
      cityLookupRetryAfter: new Date(NOW.getTime() + 15 * 60_000),
    });

    // Inside the backoff nothing is sent.
    await run(new Date(NOW.getTime() + 10 * 60_000));
    expect(geocode).toHaveBeenCalledTimes(1);

    const later = new Date(NOW.getTime() + 16 * 60_000);
    await run(later);
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(await state()).toMatchObject({
      cityLookupFailures: 2,
      cityLookupRetryAfter: new Date(later.getTime() + 30 * 60_000),
    });

    geocode.mockImplementation(async () => ok as never);
    await run(new Date(later.getTime() + 31 * 60_000));
    expect(await state()).toMatchObject({ cityLookupFailures: 0, cityLookupRetryAfter: null });
  });

  it("each attempt after a failure starts one cell further on", async () => {
    geocode.mockImplementation(async () => ({ parts: null, degraded: true }) as never);
    await run();
    await run(new Date(NOW.getTime() + 16 * 60_000));
    const [first, second] = sent();
    expect(first).not.toBe(second);
  });

  it("honours a longer Retry-After", async () => {
    geocode.mockImplementation(
      async () => ({ parts: null, degraded: true, retryAfterMs: 3 * 3_600_000 }) as never
    );
    await run();
    expect((await state())!.cityLookupRetryAfter).toEqual(new Date(NOW.getTime() + 3 * 3_600_000));
  });

  it("the backoff is 15 minutes doubling up to a day", () => {
    expect([1, 2, 3, 7, 20].map(cityBackoffMs)).toEqual([
      15 * 60_000,
      30 * 60_000,
      60 * 60_000,
      16 * 60 * 60_000,
      24 * 60 * 60_000,
    ]);
  });

  it("a tick's city budget is shared and spent", async () => {
    const budget = { left: 2 };
    await projectMonths(userId, {
      geocode,
      countryAt,
      cityIntervalMs: 0,
      now: NOW,
      cityBudget: budget,
    });
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(budget.left).toBe(0);
    const day = await prisma.travTrackDirtyDay.findFirstOrThrow({ where: { userId } });
    expect(day.done & MONTHS_BIT).toBe(0);
    expect(utcMidnight(D1)).toEqual(day.day);
  });
});

describe("lookUpCityCells — the job's own spacing", () => {
  it("spaces requests by the job interval (Nominatim: 4 a minute for scheduled jobs)", async () => {
    const times: number[] = [];
    const geocode = jest.fn(async () => {
      times.push(Date.now());
      return { parts: null, degraded: false } as never;
    });
    const cells = [
      { cell: "1.00,1.00", lat: 1, lon: 1 },
      { cell: "2.00,2.00", lat: 2, lon: 2 },
    ];
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: cells.map((c) => c.cell) } } });
    await lookUpCityCells(cells, {
      geocode,
      countryAt: () => null,
      mayLookUp: async () => true,
      intervalMs: 300,
    });
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(290);
    await prisma.geoCityCache.deleteMany({ where: { cell: { in: cells.map((c) => c.cell) } } });
  });
});

describe("retryAfterMs", () => {
  it("reads seconds and an HTTP date, and nothing else", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(retryAfterMs("120", now)).toBe(120_000);
    expect(retryAfterMs("Sun, 25 Oct 2026 13:00:00 GMT", now)).toBe(3_600_000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs("soon", now)).toBeNull();
  });
});
