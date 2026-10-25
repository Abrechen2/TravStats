import { prisma } from "../../../../db";
import { haversineKm } from "../../../../shared/geo/haversine";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { deleteTravTrackRange } from "../../deleteRange";
import { COUNTRY_DAYS_BIT, MONTHS_BIT, markTravTrackDaysDirty } from "../../dirtyDays";
import { makeFlight, makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { projectMonths } from "../project";

/**
 * TravTrack's monthly values (TravTrack plan L3, review focus 27, 28): one
 * month per transaction under the TravTrack lock, its days acknowledged on
 * their own bit only for the version read; kilometres from the privacy-safe
 * line only; a month without points absent; removed with the history it came
 * from and recomputed from what is left.
 */

const PREFIX = "travtrack-months-project-";
const D1 = "2026-10-12";
const D2 = "2026-10-13";
const OCT = "2026-10-01";
const at = (day: string, time: string) => Date.parse(`${day}T${time}Z`);
const SEOUL = { lat: 37.5665, lon: 126.978 };
const BUSAN = { lat: 35.1796, lon: 129.0756 };
const BUSAN_EAST = { lat: 35.1796, lon: 129.0856 };
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => haversineKm(a, b);

describe("projectMonths", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const dirty = (days: string[]) =>
    prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, days));
  /** The country projection's part, done: the months read its rows. */
  const countriesDone = () =>
    prisma.$executeRaw`UPDATE travtrack_dirty_days SET done = done | ${COUNTRY_DAYS_BIT}
                        WHERE user_id = ${userId}`;
  const month = (m = OCT) =>
    prisma.travTrackMonthValue.findUnique({
      where: { userId_month: { userId, month: utcMidnight(m) } },
    });
  const dirtyRow = (day: string) =>
    prisma.travTrackDirtyDay.findUniqueOrThrow({
      where: { userId_day: { userId, day: utcMidnight(day) } },
    });
  const store = (t: number, p: { lat: number; lon: number }) => storePoint(userId, { t, ...p });
  /** A short ground stretch in Busan: 10 minutes, about 0.9 km. */
  const busanWalk = async (day = D1) => {
    await store(at(day, "06:00:00"), BUSAN);
    await store(at(day, "06:10:00"), BUSAN_EAST);
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.travTrackMonthValue.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a month's points become its values once, acked on its own bit", async () => {
    await busanWalk(D1);
    await store(at(D2, "09:00:00"), SEOUL);
    await dirty([D1, D2]);
    await countriesDone();

    const result = await projectMonths(userId);

    expect(result).toMatchObject({ status: "done", projected: 1, rerun: 0, days: 2 });
    const row = await month();
    expect(row).toMatchObject({ daysWithData: 2, daysPaused: 0, cities: null, algorithm: 1 });
    expect(row!.kmGround).toBeCloseTo(km(BUSAN, BUSAN_EAST), 6);
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(MONTHS_BIT);
    expect(await projectMonths(userId)).toMatchObject({ projected: 0, days: 0 });
  });

  it("km counts only the visible line: a stretch through a zone adds nothing for its hidden chord", async () => {
    const zone = { ...SEOUL, radiusM: 500 };
    await prisma.travTrackPrivacyZone.create({ data: { userId, name: "Zuhause", ...zone } });
    // Either side of the zone, five minutes apart: stored, but their line crosses it.
    await store(at(D1, "03:00:00"), { lat: SEOUL.lat, lon: SEOUL.lon - 0.015 });
    await store(at(D1, "03:05:00"), { lat: SEOUL.lat, lon: SEOUL.lon + 0.015 });
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();

    await projectMonths(userId);

    expect((await month())!.kmGround).toBeCloseTo(km(BUSAN, BUSAN_EAST), 6);
  });

  it("a flight's points add no ground km, and nor does a step faster than 500 km/h", async () => {
    // The fixture flight is in the air 2026-10-12 00:30–01:30Z, ICN → CJU.
    await makeFlight(userId);
    await store(at(D1, "00:45:00"), { lat: 35.5, lon: 126.7 });
    await store(at(D1, "01:15:00"), { lat: 34.0, lon: 126.5 });
    // 40 km in four minutes on the ground: 600 km/h, no ground travel.
    await store(at(D1, "04:00:00"), BUSAN);
    await store(at(D1, "04:04:00"), { lat: 35.5396, lon: 129.0756 });
    await dirty([D1]);
    await countriesDone();

    await projectMonths(userId);

    const row = await month();
    expect(row).toMatchObject({ kmGround: 0, daysWithData: 1 });
  });

  it("a month without points is absent, not zero", async () => {
    await dirty([D1]);
    await countriesDone();

    expect(await projectMonths(userId)).toMatchObject({ projected: 1, days: 1 });
    expect(await month()).toBeNull();
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(MONTHS_BIT);
  });

  it("names the countries of the month's TravTrack country days only", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();
    await prisma.countryDay.createMany({
      data: [
        {
          userId,
          date: utcMidnight(D1),
          countryCode: "KR",
          source: "travtrack",
          pointCount: 1,
          spanKm: 0,
        },
        {
          userId,
          date: utcMidnight(D2),
          countryCode: "JP",
          source: "travtrack",
          pointCount: 1,
          spanKm: 0,
        },
        {
          userId,
          date: utcMidnight(D1),
          countryCode: "FR",
          source: "dawarich",
          pointCount: 1,
          spanKm: 0,
        },
        {
          userId,
          date: utcMidnight("2026-11-01"),
          countryCode: "US",
          source: "travtrack",
          pointCount: 1,
          spanKm: 0,
        },
      ],
    });

    await projectMonths(userId);

    expect((await month())!.countries).toEqual(["JP", "KR"]);
  });

  it("waits while a day of the month still owes its country days", async () => {
    await busanWalk(D1);
    await dirty([D1, D2]);
    await prisma.$executeRaw`UPDATE travtrack_dirty_days SET done = ${COUNTRY_DAYS_BIT}
                              WHERE user_id = ${userId} AND day = ${D1}::date`;

    expect(await projectMonths(userId)).toMatchObject({ projected: 0, rerun: 1, days: 0 });
    expect(await month()).toBeNull();
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(0);

    await countriesDone();
    expect(await projectMonths(userId)).toMatchObject({ projected: 1, days: 2 });
    expect(await month()).not.toBeNull();
  });

  it("a point stored during the projection re-marks its day and the month runs again", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();

    const first = await projectMonths(userId, {
      beforeAck: async () => {
        await store(at(D2, "09:00:00"), SEOUL);
        await dirty([D1]);
        await countriesDone();
      },
    });
    expect(first).toMatchObject({ projected: 0, rerun: 1, days: 0 });
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(0);

    expect(await projectMonths(userId)).toMatchObject({ projected: 1 });
    expect((await month())!.daysWithData).toBe(2);
  });

  it("deleting a day removes its month in the same transaction; the next run recomputes it", async () => {
    await busanWalk(D1);
    await store(at("2026-10-20", "09:00:00"), SEOUL);
    await dirty([D1, "2026-10-20"]);
    await countriesDone();
    await projectMonths(userId);
    expect((await month())!.daysWithData).toBe(2);

    await deleteTravTrackRange(userId, new Date(at(D1, "00:00:00")), new Date(at(D2, "00:00:00")));

    // Gone with the delete, before any run.
    expect(await month()).toBeNull();
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(0);

    await countriesDone();
    await projectMonths(userId);
    expect(await month()).toMatchObject({ daysWithData: 1, kmGround: 0 });
  });

  it("a rolled-back delete leaves the month as it was", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();
    await projectMonths(userId);
    const before = await month();

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

    expect(await month()).toEqual(before);
  });

  it("a month larger than one page is read to its end", async () => {
    await busanWalk(D1);
    await store(at(D2, "06:00:00"), BUSAN);
    await store(at(D2, "06:10:00"), BUSAN_EAST);
    await store(at("2026-10-31", "23:59:59"), SEOUL);
    await dirty([D1, D2, "2026-10-31"]);
    await countriesDone();

    await projectMonths(userId, { pageSize: 2 });

    const row = await month();
    expect(row!.daysWithData).toBe(3);
    expect(row!.kmGround).toBeCloseTo(2 * km(BUSAN, BUSAN_EAST), 6);
  });

  it("counts the days the phone reported a pause", async () => {
    await busanWalk(D1);
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-1",
        fromAt: new Date(at(D2, "22:00:00")),
        toAt: new Date(at("2026-10-14", "02:00:00")),
        reason: "permission",
      },
    });
    await dirty([D1]);
    await countriesDone();

    await projectMonths(userId);

    expect(await month()).toMatchObject({ daysWithData: 1, daysPaused: 2 });
  });

  it("TravTrack off → nothing runs and the dirty days wait", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();
    await switches.set({ beta: true, config: false });

    expect(await projectMonths(userId)).toMatchObject({ status: "disabled", projected: 0 });
    expect(await month()).toBeNull();
    expect((await dirtyRow(D1)).done & MONTHS_BIT).toBe(0);
  });

  it("an account whose provider is not TravTrack is skipped and keeps its months", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();
    await projectMonths(userId);
    await store(at(D2, "09:00:00"), SEOUL);
    await dirty([D2]);
    await setLocationProvider(userId, "none");

    expect(await projectMonths(userId)).toMatchObject({ status: "skipped" });
    expect((await month())!.daysWithData).toBe(1);
  });

  it("a failed month leaves its old row and its dirty marks", async () => {
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();
    await projectMonths(userId);
    const before = await month();
    await store(at(D2, "09:00:00"), SEOUL);
    await dirty([D2]);
    await countriesDone();

    const failed = await projectMonths(userId, {
      beforeAck: async () => {
        throw new Error("connection lost");
      },
    });

    expect(failed).toMatchObject({ status: "failed", projected: 0 });
    expect(await month()).toEqual(before);
    expect((await dirtyRow(D2)).done & MONTHS_BIT).toBe(0);
  });

  it("only this account's points count", async () => {
    const otherId = await makeUser(`${PREFIX}b`);
    await storePoint(otherId, { t: at(D1, "06:00:00"), ...SEOUL });
    await storePoint(otherId, { t: at(D1, "06:10:00"), lat: SEOUL.lat, lon: SEOUL.lon + 0.01 });
    await busanWalk(D1);
    await dirty([D1]);
    await countriesDone();

    await projectMonths(userId);

    expect((await month())!.kmGround).toBeCloseTo(km(BUSAN, BUSAN_EAST), 6);
    expect(await prisma.travTrackMonthValue.count({ where: { userId: otherId } })).toBe(0);
    await wipeTravTrack([otherId]);
  });
});
