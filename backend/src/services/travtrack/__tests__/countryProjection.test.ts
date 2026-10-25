import fs from "fs";
import path from "path";

import { prisma } from "../../../db";
import { replaceCountryDays, utcMidnight } from "../../countryDays/store";
import { COUNTRY_DAY_REDUCER_VERSION } from "../../dawarich/countryDaySweep";
import { projectTravTrackCountryDays, type CountryProjectionDeps } from "../countryProjection";
import { deleteTravTrackRange } from "../deleteRange";
import { COUNTRY_DAYS_BIT, markTravTrackDaysDirty } from "../dirtyDays";
import { ingestTravTrackPoints } from "../ingest";
import { setLocationProvider } from "../../locationProvider/provider";
import * as derivationRead from "../../locationEvidence/derivationRead";
import { makeFlight, makeUser, storePoint, wipeTravTrack } from "./fixtures";
import { travTrackSwitches } from "./switches";

/**
 * TravTrack's country days (TravTrack plan E6; review focus 24): a dirty UTC
 * day is read, reduced, replaced and acknowledged in one transaction under the
 * account's TravTrack lock, and acknowledged only for the version it read. The
 * Dawarich sweep's rows are another source and never touched.
 */

const PREFIX = "travtrack-country-projection-";
const D1 = "2026-10-12";
const D2 = "2026-10-13";
const at = (day: string, time: string) => Date.parse(`${day}T${time}Z`);

/** West of 127° is "KR", east of it "JP" — a border the test can draw. */
const countryAt = (_lat: number, lon: number) => (lon < 127 ? "KR" : "JP");
const deps: CountryProjectionDeps = { countryAt };

describe("projectTravTrackCountryDays", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const dirty = (days: string[]) =>
    prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, days));
  const rows = (source = "travtrack") =>
    prisma.countryDay.findMany({
      where: { userId, source },
      orderBy: [{ date: "asc" }, { countryCode: "asc" }],
      select: {
        date: true,
        countryCode: true,
        pointCount: true,
        airportPointCount: true,
        partialWindow: true,
      },
    });
  const dirtyRow = (day: string) =>
    prisma.travTrackDirtyDay.findUnique({
      where: { userId_day: { userId, day: utcMidnight(day) } },
    });
  const seoul = (t: number) => storePoint(userId, { t, lat: 37.5665, lon: 126.978 });

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    // The reducer version is current, so a run projects only what is dirty.
    await prisma.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, countryReducerVersion: COUNTRY_DAY_REDUCER_VERSION },
      update: { countryReducerVersion: COUNTRY_DAY_REDUCER_VERSION, lastErrorKind: null },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a dirty day becomes travtrack country days and is acked", async () => {
    await seoul(at(D1, "03:00:00"));
    await seoul(at(D1, "05:00:00"));
    await dirty([D1]);

    const result = await projectTravTrackCountryDays(userId, deps);

    expect(result).toMatchObject({ status: "done", projected: 1, rerun: 0, errorKind: null });
    expect(await rows()).toEqual([
      {
        date: utcMidnight(D1),
        countryCode: "KR",
        pointCount: 2,
        airportPointCount: 0,
        partialWindow: false,
      },
    ]);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(COUNTRY_DAYS_BIT);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state.lastErrorKind).toBeNull();
    expect(state.lastRunAt).not.toBeNull();
  });

  it("a point stored during the projection re-marks the day and it runs again", async () => {
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);

    // Between the read and the acknowledgement the day is marked again, as an
    // upload of a further point of that day does.
    const first = await projectTravTrackCountryDays(userId, {
      ...deps,
      beforeAck: async () => {
        await seoul(at(D1, "04:00:00"));
        await dirty([D1]);
      },
    });
    expect(first).toMatchObject({ status: "done", projected: 0, rerun: 1 });
    const remarked = await dirtyRow(D1);
    expect(remarked!.version).toBe(2n);
    expect(remarked!.done & COUNTRY_DAYS_BIT).toBe(0);

    const second = await projectTravTrackCountryDays(userId, deps);
    expect(second).toMatchObject({ status: "done", projected: 1, rerun: 0 });
    expect((await rows()).map((r) => r.pointCount)).toEqual([2]);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(COUNTRY_DAYS_BIT);
  });

  it("a failed day leaves the dirty row and the old rows unchanged", async () => {
    await replaceCountryDays(
      userId,
      "travtrack",
      { startAt: utcMidnight(D1), endAtExclusive: utcMidnight(D2) },
      [{ date: D1, countryCode: "JP", pointCount: 7, airportPointCount: 0, spanKm: 0 }]
    );
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);
    const before = await rows();

    const failed = await projectTravTrackCountryDays(userId, {
      ...deps,
      beforeAck: async () => {
        throw new Error("connection lost");
      },
    });

    expect(failed).toMatchObject({ status: "failed", errorKind: "database", projected: 0 });
    expect(await rows()).toEqual(before);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state.lastErrorKind).toBe("database");
  });

  it("a reducer failure is recorded as such and writes nothing", async () => {
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);

    const failed = await projectTravTrackCountryDays(userId, {
      countryAt: () => {
        throw new Error("boundary index unreadable");
      },
    });

    expect(failed).toMatchObject({ status: "failed", errorKind: "reducer" });
    expect(await rows()).toEqual([]);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);
  });

  it("the window is half-open: a point at 00:00:00Z belongs to the next day", async () => {
    await seoul(at(D2, "00:00:00"));
    await dirty([D1, D2]);

    await projectTravTrackCountryDays(userId, deps);

    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual([D2]);
  });

  it("airside-only points make no ground day; in-flight points none at all", async () => {
    // The fixture flight is in the air 2026-10-12 00:30–01:30Z.
    await makeFlight(userId);
    await seoul(at(D1, "00:45:00"));
    await seoul(at(D1, "01:15:00"));
    await storePoint(userId, { t: at(D1, "10:00:00"), lat: 37.469, lon: 127.5 });
    await dirty([D1]);

    await projectTravTrackCountryDays(userId, { ...deps, atKnownAirport: () => true });

    // Only the point on the ground remains — and it lay at a known airport,
    // so the row says airside only (pointCount === airportPointCount).
    expect(await rows()).toEqual([
      {
        date: utcMidnight(D1),
        countryCode: "JP",
        pointCount: 1,
        airportPointCount: 1,
        partialWindow: false,
      },
    ]);
  });

  it("a day over the cap is written partial", async () => {
    for (const m of [0, 10, 20, 30, 40]) await seoul(at(D1, "03:00:00") + m * 60_000);
    await dirty([D1]);

    await projectTravTrackCountryDays(userId, { ...deps, maxPoints: 2 });

    const [row] = await rows();
    expect(row.partialWindow).toBe(true);
    expect(row.pointCount).toBeLessThan(5);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(COUNTRY_DAYS_BIT);
  });

  it("deleting a range removes that day's travtrack rows in the same transaction; the next run re-derives what is left", async () => {
    await seoul(at(D1, "03:00:00"));
    await seoul(at(D1, "14:00:00"));
    await dirty([D1]);
    await projectTravTrackCountryDays(userId, deps);
    expect((await rows()).map((r) => r.pointCount)).toEqual([2]);

    await deleteTravTrackRange(userId, new Date(at(D1, "12:00:00")), new Date(at(D1, "16:00:00")));

    // Gone with the delete, not with the next run.
    expect(await rows()).toEqual([]);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);

    await projectTravTrackCountryDays(userId, deps);
    expect((await rows()).map((r) => r.pointCount)).toEqual([1]);
  });

  it("a rolled-back delete leaves the rows and the dirty day as they were", async () => {
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);
    await projectTravTrackCountryDays(userId, deps);
    const before = await rows();

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

    expect(await rows()).toEqual(before);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(COUNTRY_DAYS_BIT);
  });

  it("TravTrack off: nothing runs, the dirty days stay", async () => {
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);
    await switches.set({ beta: true, config: false });

    const result = await projectTravTrackCountryDays(userId, deps);

    expect(result).toMatchObject({ status: "disabled", errorKind: "disabled", projected: 0 });
    expect(await rows()).toEqual([]);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);
  });

  it("an account whose provider is not TravTrack is not projected; its rows stay as they are", async () => {
    await replaceCountryDays(
      userId,
      "travtrack",
      { startAt: utcMidnight(D1), endAtExclusive: utcMidnight(D2) },
      [{ date: D1, countryCode: "JP", pointCount: 7, airportPointCount: 0, spanKm: 0 }]
    );
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);
    await setLocationProvider(userId, "none");
    const before = await rows();

    const result = await projectTravTrackCountryDays(userId, deps);

    expect(result).toMatchObject({ status: "skipped", projected: 0 });
    expect(await rows()).toEqual(before);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);

    // Back on TravTrack, the waiting day runs.
    await setLocationProvider(userId, "travtrack");
    expect((await projectTravTrackCountryDays(userId, deps)).projected).toBe(1);
  });

  it("TravTrack switched off during a run stops it before the next day", async () => {
    await seoul(at(D1, "03:00:00"));
    await seoul(at(D2, "03:00:00"));
    await dirty([D1, D2]);

    const result = await projectTravTrackCountryDays(userId, {
      ...deps,
      beforeAck: async () => switches.set({ beta: true, config: false }),
    });

    expect(result).toMatchObject({ status: "disabled", projected: 1 });
    expect((await dirtyRow(D2))!.done & COUNTRY_DAYS_BIT).toBe(0);
  });

  it("a provider switch during a run stops it before the next day", async () => {
    await seoul(at(D1, "03:00:00"));
    await seoul(at(D2, "03:00:00"));
    await dirty([D1, D2]);

    const result = await projectTravTrackCountryDays(userId, {
      ...deps,
      beforeAck: async () => {
        await setLocationProvider(userId, "none");
      },
    });

    expect(result).toMatchObject({ status: "skipped", projected: 1 });
    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual([D1]);
  });

  it("the read asks between pages whether it may go on, and a cancelled read writes nothing", async () => {
    await replaceCountryDays(
      userId,
      "travtrack",
      { startAt: utcMidnight(D1), endAtExclusive: utcMidnight(D2) },
      [{ date: D1, countryCode: "JP", pointCount: 7, airportPointCount: 0, spanKm: 0 }]
    );
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);
    const before = await rows();
    let isAllowed: (() => Promise<boolean>) | undefined;
    const spy = jest
      .spyOn(derivationRead, "readTravTrackDerivation")
      .mockImplementation(async (_user, _window, opts) => {
        isAllowed = opts?.isAllowed;
        return {
          points: [],
          coverage: "truncated",
          next: null,
          generation: 0n,
          cancelled: true,
          unresolvedRun: false,
        };
      });
    try {
      const result = await projectTravTrackCountryDays(userId, deps);
      expect(result.projected).toBe(0);
    } finally {
      spy.mockRestore();
    }

    expect(await rows()).toEqual(before);
    expect((await dirtyRow(D1))!.done & COUNTRY_DAYS_BIT).toBe(0);
    expect(isAllowed).toBeDefined();
    expect(await isAllowed!()).toBe(true);
    await switches.set({ beta: true, config: false });
    expect(await isAllowed!()).toBe(false);
  });

  it("a dawarich sweep never deletes a travtrack row and the reverse", async () => {
    const window = { startAt: utcMidnight(D1), endAtExclusive: utcMidnight(D2) };
    await replaceCountryDays(userId, "dawarich", window, [
      { date: D1, countryCode: "KR", pointCount: 9, airportPointCount: 0, spanKm: 1 },
    ]);
    await seoul(at(D1, "03:00:00"));
    await dirty([D1]);

    await projectTravTrackCountryDays(userId, deps);
    expect((await rows("dawarich")).map((r) => r.pointCount)).toEqual([9]);
    expect((await rows("travtrack")).map((r) => r.pointCount)).toEqual([1]);

    // A Dawarich re-sweep that finds nothing replaces only its own rows.
    await replaceCountryDays(userId, "dawarich", window, []);
    expect(await rows("dawarich")).toEqual([]);
    expect((await rows("travtrack")).map((r) => r.pointCount)).toEqual([1]);
  });

  it("a raise of the reducer version re-marks every day holding TravTrack points once", async () => {
    await seoul(at(D1, "03:00:00"));
    await seoul(at(D2, "03:00:00"));
    await prisma.travTrackDerivationState.update({
      where: { userId },
      data: { countryReducerVersion: COUNTRY_DAY_REDUCER_VERSION - 1 },
    });

    const result = await projectTravTrackCountryDays(userId, deps);

    expect(result.projected).toBe(2);
    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual([D1, D2]);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state.countryReducerVersion).toBe(COUNTRY_DAY_REDUCER_VERSION);

    // Once: the next run finds nothing to do.
    expect((await projectTravTrackCountryDays(userId, deps)).projected).toBe(0);
  });

  it("projects at most the run's budget of days, oldest first", async () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03"];
    for (const day of days) await seoul(at(day, "03:00:00"));
    await dirty(days);

    const result = await projectTravTrackCountryDays(userId, { ...deps, maxDays: 2 });

    expect(result.projected).toBe(2);
    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual(days.slice(0, 2));
  });

  it("ingest marks only stored points' days dirty", async () => {
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u-dirty-1",
      points: [
        { id: "a", t: `${D1}T03:00:00Z`, lat: 37.5665, lon: 126.978, accuracy: 12 },
        // Not a point: no time it could be stored at, so no day to mark.
        { id: "b", t: "not a time", lat: 37.5665, lon: 126.978, accuracy: 12 },
      ],
    });

    const marked = await prisma.travTrackDirtyDay.findMany({ where: { userId } });
    expect(marked.map((r) => r.day.toISOString().slice(0, 10))).toEqual([D1]);
    expect(marked[0].done).toBe(0);
  });

  it("the Dawarich sweep's files are not edited by this projection", () => {
    // `store.ts` is shared and only gained an optional transaction; the sweep
    // and its scheduler still call it the way they always did.
    const sweep = fs.readFileSync(
      path.join(__dirname, "../../dawarich/countryDaySweep.ts"),
      "utf8"
    );
    expect(sweep).not.toMatch(/travtrack/i);
  });
});
