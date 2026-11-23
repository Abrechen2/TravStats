import { prisma } from "../../../db";
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
    const result = await projectInferredCountryDays(userId, countryAt, NOW);
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
    await projectInferredCountryDays(userId, countryAt, NOW);
    expect(await rows()).toHaveLength(3);
    await storePoint(userId, { t: at("2026-10-12T10:00:00Z"), ...ELSEWHERE });
    await projectInferredCountryDays(userId, countryAt, NOW);
    expect(await rows()).toHaveLength(0);
  });

  it("never writes a day that is still going on", async () => {
    await storePoint(userId, { t: at("2026-10-17T20:00:00Z"), ...HOME });
    await storePoint(userId, { t: at("2026-10-21T05:00:00Z"), ...HOME });
    await projectInferredCountryDays(userId, countryAt, NOW);
    expect((await rows()).map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-18",
      "2026-10-19",
    ]);
  });
});
