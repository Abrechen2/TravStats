import { prisma } from "../../../db";
import { deleteTravTrackPoint } from "../deletePoint";
import { createZone } from "../zones";
import { projectInferredCountryDays } from "../silence/inferredCountryDays";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * A quiet stretch at home leaves whole days with no point. They reach the country days as the
 * separate `travtrack-inferred` source (pointCount 0), only when both ends are at one known place.
 */

const PREFIX = "travtrack-inferred-days-";
const at = (iso: string) => Date.parse(iso);
const HOME = { lat: 47.8265, lon: 12.1902 };
const ELSEWHERE = { lat: 48.137, lon: 11.575 };
const NOW = new Date("2026-10-20T12:00:00Z");
const countryAt = () => "DE";

describe("TravTrack — country days of a silence spent at a known place", () => {
  let userId: string;
  const rows = () =>
    prisma.countryDay.findMany({
      where: { userId, source: "travtrack-inferred" },
      orderBy: { date: "asc" },
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: {
        userId,
        data: {
          display: { timezone: "Europe/Berlin" },
          homePeriods: [
            {
              fromDate: "2000-01-01",
              toDate: null,
              airports: [{ code: "MUC", primary: true }],
              residence: { ...HOME, name: "Riedering" },
              residenceConfirmed: true,
            },
          ],
        },
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("whole UTC days between two home fixes become inferred rows with no point count", async () => {
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    const result = await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(result.written).toBe(3);
    expect(
      (await rows()).map((r) => [r.date.toISOString().slice(0, 10), r.countryCode, r.pointCount])
    ).toEqual([
      ["2026-10-11", "DE", 0],
      ["2026-10-12", "DE", 0],
      ["2026-10-13", "DE", 0],
    ]);
  });

  it("ends at different places write nothing, and a later run removes rows a new fix made untrue", async () => {
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(await rows()).toHaveLength(3);
    await storePoint(userId, { t: at("2026-10-12T10:00:00Z"), ...ELSEWHERE });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(await rows()).toHaveLength(0);
  });

  it("never writes a day that is still going on", async () => {
    await storePoint(userId, { t: at("2026-10-17T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-21T05:00:00Z"), ...HOME });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-18",
      "2026-10-19",
    ]);
  });

  it("deleting the end point of a multi-day silence removes ALL its inferred days, not only the end's", async () => {
    await storePoint(userId, { t: at("2026-10-01T20:00:00Z"), ...HOME });
    const end = await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect((await rows()).length).toBe(12);
    await deleteTravTrackPoint(userId, end);
    // 2026-10-02 is far from the deleted point's own day and its neighbours.
    expect(await rows()).toHaveLength(0);
  });

  it("a privacy zone around home removes the inferred days, and a rebuild does not bring them back", async () => {
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(await rows()).toHaveLength(3);
    await createZone(userId, { name: "Home", ...HOME, radiusM: 300 }, true);
    expect(await rows()).toHaveLength(0);
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(await rows()).toHaveLength(0);
  });

  it("a run drops inferred rows older than any window once their end fixes are gone", async () => {
    const old = NOW.getTime() - 400 * 86_400_000;
    await prisma.countryDay.create({
      data: {
        userId,
        date: new Date(old),
        countryCode: "DE",
        source: "travtrack-inferred",
        pointCount: 0,
        airportPointCount: 0,
        spanKm: 0,
      },
    });
    await projectInferredCountryDays(userId, countryAt, null, NOW);
    expect(await rows()).toHaveLength(0);
  });

  it("an incremental run recomputes only the silences touching its days and leaves other rows alone", async () => {
    await storePoint(userId, { t: at("2026-09-01T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-09-05T05:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-10T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    // A stale row far outside the scope: a whole-history run would delete it, a scoped one must not.
    await prisma.countryDay.create({
      data: {
        userId,
        date: new Date("2026-09-20T00:00:00Z"),
        countryCode: "FR",
        source: "travtrack-inferred",
        pointCount: 0,
        airportPointCount: 0,
        spanKm: 0,
      },
    });
    const result = await projectInferredCountryDays(
      userId,
      countryAt,
      { fromDay: "2026-10-12", toDay: "2026-10-12" },
      NOW
    );
    expect(result.written).toBe(3);
    const days = (await rows()).map((r) => r.date.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-09-20", "2026-10-11", "2026-10-12", "2026-10-13"]);
  });

  it("a deletion or a zone change flags the account for one full rebuild", async () => {
    const end = await storePoint(userId, { t: at("2026-10-14T05:00:00Z"), ...HOME });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await deleteTravTrackPoint(userId, end);
    const state = await prisma.travTrackDerivationState.findUnique({ where: { userId } });
    expect(state?.inferredRebuildDue).toBe(true);
  });
});
