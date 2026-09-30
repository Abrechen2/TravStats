import { prisma } from "../../../db";
import { detectTrips } from "../../tripDetectionService";
import { tripNameLanguageOf, tripNameMonth } from "../tripGrouping";

/**
 * Suggested trip names were built with a hard-wired `toLocaleDateString("en")`
 * in both the detection service and the batch import, so a German interface
 * was offered "FRA ↺ JFK · Oct 2026" instead of "Okt. 2026".
 */
describe("trip naming language", () => {
  it("reads the reader's language, German when unset", () => {
    expect(tripNameLanguageOf({ display: { language: "en" } })).toBe("en");
    expect(tripNameLanguageOf({ display: { language: "de" } })).toBe("de");
    expect(tripNameLanguageOf({ display: {} })).toBe("de");
    expect(tripNameLanguageOf(null)).toBe("de");
  });

  it("labels the month in that language, in UTC", () => {
    const oct = new Date("2026-10-31T23:30:00Z");
    expect(tripNameMonth(oct, "de")).toBe("Okt. 2026");
    expect(tripNameMonth(oct, "en")).toBe("Oct 2026");
  });

  describe("detectTrips proposals", () => {
    let userId: string;

    beforeEach(async () => {
      await prisma.user.deleteMany({ where: { username: "trip-naming-lang" } });
      const user = await prisma.user.create({
        data: { username: "trip-naming-lang", passwordHash: "x" },
      });
      userId = user.id;
      const leg = (n: number, dep: string, arr: string, day: string) => ({
        userId,
        flightNumber: `TN${n}`,
        bookingReference: "TNLANG",
        depIata: dep,
        arrIata: arr,
        depLat: 50,
        depLon: 8,
        arrLat: 41,
        arrLon: -74,
        departureTime: new Date(`${day}T10:00:00Z`),
        arrivalTime: new Date(`${day}T18:00:00Z`),
        status: "flown" as const,
      });
      await prisma.flight.createMany({
        data: [
          leg(1, "FRA", "JFK", "2026-10-05"),
          leg(2, "JFK", "BOS", "2026-10-08"),
          leg(3, "BOS", "FRA", "2026-10-12"),
        ],
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { username: "trip-naming-lang" } });
    });

    it("names the proposal in German for a German reader", async () => {
      await prisma.userSettings.create({
        data: { userId, data: { display: { language: "de" } } },
      });
      const { proposed } = await detectTrips({ userId, dryRun: true });
      expect(proposed).toHaveLength(1);
      expect(proposed[0].suggestedName).toMatch(/· Okt\. 2026$/);
    });

    it("names the proposal in English for an English reader", async () => {
      await prisma.userSettings.create({
        data: { userId, data: { display: { language: "en" } } },
      });
      const { proposed } = await detectTrips({ userId, dryRun: true });
      expect(proposed[0].suggestedName).toMatch(/· Oct 2026$/);
    });
  });
});
