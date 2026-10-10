import { prisma } from "../../../db";
import { resolveMetricEvidence } from "../metricEvidence";
import { buildStatsPage } from "../../stats/statsPage";
import { buildTravelRecords, loadRecordFlights } from "../../stats/records";

/**
 * The flights behind the flight tab's "most" figures (forgejo#256): each
 * panel lists exactly the flights the figure was taken from, by the
 * figure's own calculation.
 *
 * Fixture: a Frankfurt → London → New York chain on one day (a 3 h layover in
 * London), a long-haul Frankfurt → Singapore a year later, and two flights
 * that do not count (planned, cancelled).
 */
const USER = "evidencewitnesses";
const allTime = { period: { kind: "allTime" as const } };
const page = { offset: 0, limit: 50 };

const FRA = { depIata: "FRA", depLat: 50.0379, depLon: 8.5622 };
const LHR = { lat: 51.47, lon: -0.4543 };
const JFK = { lat: 40.6413, lon: -73.7781 };
const SIN = { lat: 1.3644, lon: 103.9915 };

describe("witness evidence behind the flight tab's extremes (forgejo#256)", () => {
  let userId: string;
  const ids: Record<string, string> = {};

  const flight = async (
    name: string,
    data: Record<string, unknown>,
    status = "flown"
  ): Promise<void> => {
    ids[name] = (
      await prisma.flight.create({
        data: {
          userId,
          status,
          depTimeSemantics: "UTC",
          arrTimeSemantics: "UTC",
          depTimezone: "UTC",
          arrTimezone: "UTC",
          ...data,
        } as never,
      })
    ).id;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await flight("fraLhr", {
      ...FRA,
      arrIata: "LHR",
      arrLat: LHR.lat,
      arrLon: LHR.lon,
      flightNumber: "LH900",
      airline: "Lufthansa",
      departureTime: new Date("2024-05-10T06:00:00Z"),
      arrivalTime: new Date("2024-05-10T07:30:00Z"),
    });
    await flight("lhrJfk", {
      depIata: "LHR",
      depLat: LHR.lat,
      depLon: LHR.lon,
      arrIata: "JFK",
      arrLat: JFK.lat,
      arrLon: JFK.lon,
      flightNumber: "BA117",
      airline: "British Airways",
      departureTime: new Date("2024-05-10T10:30:00Z"),
      arrivalTime: new Date("2024-05-10T18:30:00Z"),
    });
    await flight("fraSin", {
      ...FRA,
      arrIata: "SIN",
      arrLat: SIN.lat,
      arrLon: SIN.lon,
      flightNumber: "LH778",
      airline: "Lufthansa",
      departureTime: new Date("2025-03-01T20:00:00Z"),
      arrivalTime: new Date("2025-03-02T08:00:00Z"),
    });
    await flight(
      "planned",
      {
        ...FRA,
        arrIata: "SIN",
        arrLat: SIN.lat,
        arrLon: SIN.lon,
        departureTime: new Date("2027-01-01T08:00:00Z"),
        arrivalTime: new Date("2027-01-01T20:00:00Z"),
      },
      "scheduled"
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const listedIds = async (key: string): Promise<string[]> => {
    const res = await resolveMetricEvidence(userId, key, allTime, page);
    expect(res?.measure.aggregation).toBe("sum");
    expect(res?.measure.value).toBe(res?.entries.length);
    return (res?.entries ?? []).map((e) => e.id).sort();
  };

  it("the records name the flight, the day and the streak they were taken from", async () => {
    const records = buildTravelRecords(await loadRecordFlights(userId));
    const longest = records.find((r) => r.id === "longest-flight");
    expect(longest?.flightId).toBe(ids.fraSin);
    expect(await listedIds("recordLongestFlight")).toEqual([ids.fraSin]);
    expect(await listedIds("recordShortestFlight")).toEqual([ids.fraLhr]);
    expect(await listedIds("recordBusiestDay")).toEqual([ids.fraLhr, ids.lhrJfk].sort());
  });

  it("the distance extremes list the longest and the shortest leg", async () => {
    expect(await listedIds("longestDistanceFlights")).toEqual([ids.fraSin]);
    expect(await listedIds("shortestDistanceFlights")).toEqual([ids.fraLhr]);
  });

  it("the fun extremes list the flights their winner was chosen from", async () => {
    const { fun } = await buildStatsPage(userId, new Set(["fun"]));
    expect(await listedIds("busiestDayFlights")).toHaveLength(fun!.fastestDayFlights);
    expect(await listedIds("loyaltyAirlineFlights")).toEqual([ids.fraLhr, ids.fraSin].sort());
    expect(await listedIds("milestoneYearFlights")).toHaveLength(fun!.milestoneYearFlights);
  });

  it("the unique extremes list the chain, the layover's two flights and the busiest-countries day", async () => {
    const { unique } = await buildStatsPage(userId, new Set(["unique"]));
    expect(unique!.longestTravelChain).toBe(2);
    expect(await listedIds("travelChainFlights")).toEqual([ids.fraLhr, ids.lhrJfk].sort());
    expect(await listedIds("longestLayoverFlights")).toEqual([ids.fraLhr, ids.lhrJfk].sort());
    expect(await listedIds("mostCountriesDayFlights")).toEqual([ids.fraLhr, ids.lhrJfk].sort());
    expect(await listedIds("northernmostFlights")).toEqual([ids.fraLhr, ids.lhrJfk].sort());
    expect(await listedIds("southernmostFlights")).toEqual([ids.fraSin]);
  });

  it("never lists a flight that does not count", async () => {
    for (const key of ["longestDistanceFlights", "seasonFlights", "routeMasterFlights"]) {
      expect(await listedIds(key)).not.toContain(ids.planned);
    }
  });

  it("is lifetime only", async () => {
    await expect(
      resolveMetricEvidence(
        userId,
        "recordLongestFlight",
        { period: { kind: "year", year: 2024 } },
        page
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
