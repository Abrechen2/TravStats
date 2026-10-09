/**
 * forgejo#273 — every evidence row names the day its record is COUNTED under.
 *
 * A flight is counted on its departure airport's day (the timeseries, the
 * records, the passport); the panel cut the stored instant at UTC midnight
 * instead, so a Tokyo departure at 07:30 local showed the day before and a New
 * York departure at 22:00 the day after. A date-only flight shows the day it
 * was recorded on — the local day of its stored instant, which its writer
 * converted from a local wall clock through the same zone; a flight with no stored zone is read in
 * the catalogue's, and with neither on its stored components — the fallback
 * `localWallClockOf` makes for every flight statistic.
 *
 * Rail rides are counted on their departure station's calendar
 * (`shared/railCounting.ts`), and a place list carries a real creation
 * instant, read in the user's profile zone. A stay's check-in, a cruise's
 * start and a place visit store their local day already and are not touched.
 *
 * Each case below names a different loader, because the defect lived in every
 * projection separately: one select that forgot the clock is one panel that
 * still shows the UTC day.
 */
import { prisma } from "../../../db";
import type { EvidenceKind, EvidenceScope } from "../../../shared/evidence";
import type { EvidenceResponse } from "../../../schemas/evidence";
import { resolveEvidence } from "../index";
import { toUtcDate } from "../../flights/mergedChronology";

jest.mock("../../airportCache", () => {
  const actual = jest.requireActual("../../airportCache");
  const catalogue = new Map<string, { country: string | null; timezone: string | null }>([
    ["NRT", { country: "JP", timezone: "Asia/Tokyo" }],
    ["JFK", { country: "US", timezone: "America/New_York" }],
    ["AKL", { country: "NZ", timezone: "Pacific/Auckland" }],
    ["SYD", { country: "AU", timezone: "Australia/Sydney" }],
    ["MUC", { country: "DE", timezone: "Europe/Berlin" }],
    ["HGA", { country: "SO", timezone: null }],
    ["DXB", { country: "AE", timezone: "Asia/Dubai" }],
  ]);
  return {
    ...actual,
    getCachedAirports: jest.fn(
      async (codes: string[]) =>
        new Map(codes.filter((c) => catalogue.has(c)).map((c) => [c, catalogue.get(c)]))
    ),
  };
});

const USER = "evidencelocalday";
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const YEAR_2026: EvidenceScope = { period: { kind: "year", year: 2026 } };
const PAGE = { offset: 0, limit: 50 };

const COORDS: Record<string, { lat: number; lon: number }> = {
  NRT: { lat: 35.7647, lon: 140.3863 },
  JFK: { lat: 40.6413, lon: -73.7781 },
  AKL: { lat: -37.0082, lon: 174.785 },
  SYD: { lat: -33.9461, lon: 151.1772 },
  MUC: { lat: 48.3538, lon: 11.7861 },
  HGA: { lat: 9.5182, lon: 44.0888 },
  DXB: { lat: 25.2528, lon: 55.3644 },
};

describe("evidence rows are dated on the day they are counted under (forgejo#273)", () => {
  let userId: string;
  /** Flight / ride / list id → the day its row must show. */
  const expected = new Map<string, string>();

  const addFlight = async (
    dep: string,
    arr: string,
    departure: string,
    over: Record<string, unknown>,
    day: string
  ): Promise<void> => {
    const row = await prisma.flight.create({
      data: {
        userId,
        depIata: dep,
        arrIata: arr,
        depLat: COORDS[dep].lat,
        depLon: COORDS[dep].lon,
        arrLat: COORDS[arr].lat,
        arrLon: COORDS[arr].lon,
        departureTime: new Date(departure),
        arrivalTime: new Date(new Date(departure).getTime() + 3 * 3_600_000),
        depTimeSemantics: "UTC",
        arrTimeSemantics: "UTC",
        status: "flown",
        airline: "All Nippon Airways",
        airlineIata: "NH",
        aircraft: "B789",
        price: 100,
        currency: "EUR",
        delayMinutes: 5,
        ...over,
      },
    });
    expected.set(row.id, day);
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Tokyo" } } },
    });

    // East of UTC: 07:30 in Tokyo on 2 September is 22:30Z on the 1st.
    await addFlight(
      "NRT",
      "MUC",
      "2026-09-01T22:30:00Z",
      { depTimezone: "Asia/Tokyo" },
      "2026-09-02"
    );
    // West of UTC: 22:00 in New York on 1 September is 02:00Z on the 2nd.
    await addFlight(
      "JFK",
      "MUC",
      "2026-09-02T02:00:00Z",
      { depTimezone: "America/New_York" },
      "2026-09-01"
    );
    // Date-only, written as the form writes it: 12:00 LOCAL through the zone.
    // In Auckland's summer that is 23:00Z on the day before (forgejo#273).
    await addFlight(
      "AKL",
      "SYD",
      (toUtcDate("2026-01-15T12:00", "Pacific/Auckland") as Date).toISOString(), // 23:00Z on the 14th
      {
        depTimezone: "Pacific/Auckland",
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
        arrivalTime: toUtcDate("2026-01-15T12:00", "Australia/Sydney"),
        status: "historical",
      },
      "2026-01-15"
    );
    // No stored zone: the catalogue's (Tokyo) — 20:00Z on 1 March is 05:00 on the 2nd.
    await addFlight("NRT", "MUC", "2026-03-01T20:00:00Z", { depTimezone: null }, "2026-03-02");
    // No zone anywhere: the stored components.
    await addFlight("HGA", "DXB", "2026-03-10T23:30:00Z", { depTimezone: null }, "2026-03-10");

    // A night train leaving Vienna at 00:20 on 2 January — 23:20Z on the 1st.
    const ride = await prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Wien Hbf",
        depLat: 48.185,
        depLon: 16.376,
        depCountry: "AT",
        depTimezone: "Europe/Vienna",
        arrStationName: "München Hbf",
        arrLat: 48.14,
        arrLon: 11.558,
        arrCountry: "DE",
        arrTimezone: "Europe/Berlin",
        departureTime: new Date("2026-01-01T23:20:00Z"),
        arrivalTime: new Date("2026-01-02T05:30:00Z"),
        status: "completed",
      },
    });
    expected.set(ride.id, "2026-01-02");

    // A list made at 07:30 Tokyo time — the user's profile zone.
    const list = await prisma.placeList.create({
      data: { userId, name: "Ramen", createdAt: new Date("2026-09-01T22:30:00Z") },
    });
    expected.set(list.id, "2026-09-02");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function resolve(kind: EvidenceKind, key: string, scope = ALL): Promise<EvidenceResponse> {
    const result = await resolveEvidence(userId, kind, key, scope, PAGE);
    if (result.status !== "ok") throw new Error(`${kind}:${key} → ${result.status}`);
    return result.response;
  }

  /** Every listed row carries the day its record is counted under. */
  function expectLocalDays(response: EvidenceResponse): void {
    expect(response.entries.length).toBeGreaterThan(0);
    for (const entry of response.entries) {
      const day = expected.get(entry.id);
      if (day === undefined) continue; // a row this suite did not plant (none expected)
      expect({ id: entry.id, date: entry.date?.value }).toEqual({ id: entry.id, date: day });
    }
  }

  it.each([
    "flightCount",
    "flightTimeMinutes",
    "airlineCount",
    "flightsWithoutAirlineCount",
    "businessTotalCost",
    "punctualitySampleSize",
    "airportsVisitedCount",
    "flightCountriesVisitedCount",
    "eastwardFlightCount",
    "westwardFlightCount",
    "timezoneHopperFlightCount",
    "crossDomainEventCount",
    "railRideCount",
    "placeListCount",
    "passportEntryCount",
  ])("metric %s", async (key) => {
    if (key === "flightsWithoutAirlineCount") {
      // Every planted flight has an airline; this measure lists none of them.
      const response = await resolve("metric", key);
      expect(response.entries).toHaveLength(0);
      return;
    }
    expectLocalDays(await resolve("metric", key));
  });

  it("the year family (summary rows)", async () => {
    expectLocalDays(await resolve("metric", "yearFlightCount", YEAR_2026));
  });

  it.each(["airline:iata:NH", "airport:NRT", "country:JP", "aircraftType:B789"])(
    "ranking %s",
    async (key) => {
      expectLocalDays(await resolve("ranking", key));
    }
  );

  it("lists both sides of UTC midnight on their local days", async () => {
    const response = await resolve("metric", "flightCount");
    const days = response.entries.map((e) => e.date?.value).sort();
    expect(days).toEqual(["2026-01-15", "2026-03-02", "2026-03-10", "2026-09-01", "2026-09-02"]);
  });
});
