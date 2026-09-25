import { prisma } from "../../db";
import { deriveTimezone } from "../airportLookup";
import {
  AIRPORT_TIMEZONE_DATASET,
  refoldedZone,
  repairFoldedAirportTimezones,
  sameClockToday,
} from "../airportTimezoneRepair";

/**
 * CAMP-03: BKK carried Asia/Jakarta. Not a catalogue typo — geo-tz's default
 * "now" dataset folds every zone that keeps today's clock into one name, and
 * the backfill wrote whatever it answered. Measured on a test catalogue: 526
 * airports, Dublin as Europe/London and Tahiti as Pacific/Honolulu among them.
 *
 * The settings row is a singleton that ten other suites delete and recreate
 * while this one runs, so nothing here asserts on it: the rule is tested
 * pure, the repair by what it did to an airport, and the run-once gate with a
 * stubbed read of the row.
 */
describe("airport time zones from the full geo-tz dataset", () => {
  const NAME = "tz-repair-test";

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.airport.deleteMany({ where: { name: { startsWith: NAME } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("derives Bangkok, Dublin and Berlin by their own names", () => {
    expect(deriveTimezone(13.69, 100.7501)).toBe("Asia/Bangkok");
    expect(deriveTimezone(53.4213, -6.2701)).toBe("Europe/Dublin");
    expect(deriveTimezone(52.3667, 13.5033)).toBe("Europe/Berlin");
  });

  it("renames a fold and keeps a zone that keeps a different clock", () => {
    expect(refoldedZone("Asia/Jakarta", "Asia/Bangkok")).toBe("Asia/Bangkok");
    expect(refoldedZone("Asia/Tokyo", "Asia/Bangkok")).toBeNull();
    expect(refoldedZone("Asia/Bangkok", "Asia/Bangkok")).toBeNull();
    expect(refoldedZone("Asia/Jakarta", null)).toBeNull();
  });

  it("writes the renamed zone into the catalogue", async () => {
    const bangkok = await prisma.airport.create({
      data: { name: `${NAME} bkk`, lat: 13.69, lon: 100.7501, timezone: "Asia/Jakarta" },
    });
    const chosen = await prisma.airport.create({
      data: { name: `${NAME} chosen`, lat: 13.69, lon: 100.7501, timezone: "Asia/Tokyo" },
    });

    await repairFoldedAirportTimezones({ force: true });

    expect((await prisma.airport.findUnique({ where: { id: bangkok.id } }))?.timezone).toBe(
      "Asia/Bangkok"
    );
    expect((await prisma.airport.findUnique({ where: { id: chosen.id } }))?.timezone).toBe(
      "Asia/Tokyo"
    );
  });

  it("does not run again once the row says it ran", async () => {
    jest
      .spyOn(prisma.adminSettings, "findFirst")
      .mockResolvedValue({ id: 1, airportTimezoneDataset: AIRPORT_TIMEZONE_DATASET } as never);
    const scan = jest.spyOn(prisma.airport, "findMany");

    expect(await repairFoldedAirportTimezones()).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it("calls two zones one clock only when winter AND summer agree", () => {
    expect(sameClockToday("Asia/Jakarta", "Asia/Bangkok")).toBe(true);
    expect(sameClockToday("Europe/London", "Europe/Dublin")).toBe(true);
    expect(sameClockToday("Europe/Berlin", "Europe/London")).toBe(false);
    expect(sameClockToday("Asia/Bangkok", "Not/AZone")).toBe(false);
  });
});
