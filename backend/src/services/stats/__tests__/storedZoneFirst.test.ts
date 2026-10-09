/**
 * forgejo#273 (re-review M3) — every flight figure reads a departure in the
 * zone the flight was WRITTEN with, and only for a row that stored none in
 * today's catalogue zone (`flightEndZone`). The countries-by-year list, the
 * cross-domain overview and the travel account read the catalogue alone, so
 * after a catalogue correction one flight could be one day in the time series
 * and another in them. A date-only cruise-import flight at 00:00 local moves a
 * day with ANY zone difference.
 *
 * The flight below was written in Tokyo — 05:00 on 1 January 2026 — while
 * today's catalogue (mocked) files its airport in Berlin, where the same
 * instant is 21:00 on 31 December 2025.
 */
import { prisma } from "../../../db";
import { FLIGHT_CLOCK_SELECT } from "../departureClock";
import { computeCountryStats } from "../countryStats";
import { fetchFlightDatedRows } from "../timeseriesRows";
import { loadTravelAccountData } from "../travelAccountData";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
import { resolveEvidence } from "../../evidence";

jest.mock("../../airportCache", () => {
  const actual = jest.requireActual("../../airportCache");
  const catalogue = new Map([
    ["NRT", { country: "JP", timezone: "Europe/Berlin" }], // a catalogue that disagrees with the row
    ["MUC", { country: "DE", timezone: "Europe/Berlin" }],
  ]);
  return {
    ...actual,
    getCachedAirports: jest.fn(
      async (codes: string[]) =>
        new Map(codes.filter((c) => catalogue.has(c)).map((c) => [c, catalogue.get(c)]))
    ),
  };
});

const USER = "storedzonefirst";
const DEPARTURE = new Date("2025-12-31T20:00:00Z"); // 05:00 on 1 Jan in Tokyo

describe("a flight's day is read in its stored zone in every figure (forgejo#273)", () => {
  let userId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "NRT",
          arrIata: "MUC",
          depLat: 35.7647,
          depLon: 140.3863,
          arrLat: 48.3538,
          arrLon: 11.7861,
          departureTime: DEPARTURE,
          arrivalTime: new Date("2026-01-01T09:00:00Z"),
          depTimezone: "Asia/Tokyo",
          arrTimezone: "Europe/Berlin",
          depTimeSemantics: "UTC",
          arrTimeSemantics: "UTC",
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("the time series files it on 1 January 2026 (stored first already)", async () => {
    const rows = await fetchFlightDatedRows(
      userId,
      new Date("2025-12-01T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z")
    );
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-01-01"]);
  });

  it("the countries-by-year list files it in 2026 too", async () => {
    const rows = await prisma.flight.findMany({
      where: { userId },
      select: { ...FLIGHT_CLOCK_SELECT, departureTime: true },
    });
    const result = await computeCountryStats(rows);
    expect(Object.keys(result.byYear)).toEqual(["2026"]);
  });

  it("the cross-domain overview dates it on 1 January 2026", async () => {
    const result = await resolveEvidence(
      userId,
      "metric",
      "crossDomainEventCount",
      { period: { kind: "allTime" } },
      { offset: 0, limit: 10 }
    );
    if (result.status !== "ok") throw new Error(result.status);
    const entry = result.response.entries.find((e) => e.id === flightId);
    expect(entry?.date?.value).toBe("2026-01-01");
  });

  it("the travel account reads the same departure day", async () => {
    // Every domain visible: the zone rule is under test, not the domain gate
    // (fix/trip-account-contract gave the loader its visibility argument).
    const data = await loadTravelAccountData(userId, new Set(AVAILABLE_DOMAINS));
    const row = data.flights.find((f) => f.id === flightId);
    expect(row?.depLocalDay?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(row?.depTimezone).toBe("Asia/Tokyo");
  });
});
