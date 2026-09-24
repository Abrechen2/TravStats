import { prisma } from "../../db";
import { deriveTimezone } from "../airportLookup";
import {
  AIRPORT_TIMEZONE_DATASET,
  repairFoldedAirportTimezones,
  sameClockToday,
} from "../airportTimezoneRepair";

/**
 * CAMP-03: BKK carried Asia/Jakarta. Not a catalogue typo — geo-tz's default
 * "now" dataset folds every zone that keeps today's clock into one name, and
 * the backfill wrote whatever it answered. Measured on a test catalogue: 526
 * airports, Dublin as Europe/London and Tahiti as Pacific/Honolulu among them.
 */
describe("airport time zones from the full geo-tz dataset", () => {
  const NAME = "tz-repair-test";
  let settingsId: number;
  let previousMarker: string | null;

  beforeAll(async () => {
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousMarker = settings.airportTimezoneDataset;
  });

  beforeEach(async () => {
    await prisma.airport.deleteMany({ where: { name: { startsWith: NAME } } });
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { airportTimezoneDataset: null },
    });
  });

  afterAll(async () => {
    await prisma.airport.deleteMany({ where: { name: { startsWith: NAME } } });
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { airportTimezoneDataset: previousMarker },
    });
    await prisma.$disconnect();
  });

  it("derives Bangkok, Dublin and Berlin by their own names", () => {
    expect(deriveTimezone(13.69, 100.7501)).toBe("Asia/Bangkok");
    expect(deriveTimezone(53.4213, -6.2701)).toBe("Europe/Dublin");
    expect(deriveTimezone(52.3667, 13.5033)).toBe("Europe/Berlin");
  });

  it("renames a folded zone once, keeps a chosen one, and records that it ran", async () => {
    const bangkok = await prisma.airport.create({
      data: { name: `${NAME} bkk`, lat: 13.69, lon: 100.7501, timezone: "Asia/Jakarta" },
    });
    // A different clock is somebody's choice, not a fold: left alone.
    const chosen = await prisma.airport.create({
      data: { name: `${NAME} chosen`, lat: 13.69, lon: 100.7501, timezone: "Asia/Tokyo" },
    });

    expect(await repairFoldedAirportTimezones()).toBeGreaterThanOrEqual(1);

    expect((await prisma.airport.findUnique({ where: { id: bangkok.id } }))?.timezone).toBe(
      "Asia/Bangkok"
    );
    expect((await prisma.airport.findUnique({ where: { id: chosen.id } }))?.timezone).toBe(
      "Asia/Tokyo"
    );
    const settings = await prisma.adminSettings.findUnique({ where: { id: settingsId } });
    expect(settings?.airportTimezoneDataset).toBe(AIRPORT_TIMEZONE_DATASET);
  });

  it("does not run a second time", async () => {
    await prisma.adminSettings.update({
      where: { id: settingsId },
      data: { airportTimezoneDataset: AIRPORT_TIMEZONE_DATASET },
    });
    const folded = await prisma.airport.create({
      data: { name: `${NAME} again`, lat: 13.69, lon: 100.7501, timezone: "Asia/Jakarta" },
    });

    expect(await repairFoldedAirportTimezones()).toBe(0);
    expect((await prisma.airport.findUnique({ where: { id: folded.id } }))?.timezone).toBe(
      "Asia/Jakarta"
    );
  });

  it("calls two zones one clock only when winter AND summer agree", () => {
    expect(sameClockToday("Asia/Jakarta", "Asia/Bangkok")).toBe(true);
    expect(sameClockToday("Europe/London", "Europe/Dublin")).toBe(true);
    expect(sameClockToday("Europe/Berlin", "Europe/London")).toBe(false);
    expect(sameClockToday("Asia/Bangkok", "Not/AZone")).toBe(false);
  });
});
