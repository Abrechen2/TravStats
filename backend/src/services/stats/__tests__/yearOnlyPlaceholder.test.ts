/**
 * forgejo#256 — a flight known only by its YEAR stays in that year in every
 * figure that files flights by year.
 *
 * A year-only historical entry has no clock: its semantics stay `UNKNOWN` and
 * the schema stores 1 January at midnight UTC. Read through a western
 * departure airport's zone that instant is the evening of 31 December, so the
 * flight was counted in the year BEFORE the one it names — in the summary's
 * year cards, the time series, the flight insights and the dates the flight
 * page shows (`placeholderDayOf`).
 */
import { prisma } from "../../../db";
import { buildWhere, computeSummary } from "../summary";
import { fetchFlightDatedRows } from "../timeseriesRows";
import { loadFlightInsightRows } from "../flightInsights/rows";

const USER = "yearonlyplaceholder";

describe("a year-only flight is filed under the year it names (forgejo#256)", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await prisma.flight.create({
      data: {
        userId,
        depIata: "JFK",
        arrIata: "LAX",
        depLat: 40.6413,
        depLon: -73.7781,
        arrLat: 33.9416,
        arrLon: -118.4085,
        departureTime: new Date("2015-01-01T00:00:00Z"),
        arrivalTime: new Date("2015-01-01T00:00:00Z"),
        depTimezone: "America/New_York",
        arrTimezone: "America/Los_Angeles",
        depTimeSemantics: "UNKNOWN",
        arrTimeSemantics: "UNKNOWN",
        status: "historical",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("the year summary counts it in 2015, not in 2014", async () => {
    const in2015 = await computeSummary(
      await buildWhere(userId, undefined, undefined, 2015),
      "EUR"
    );
    const in2014 = await computeSummary(
      await buildWhere(userId, undefined, undefined, 2014),
      "EUR"
    );
    expect(in2015.stats.totalFlights).toBe(1);
    expect(in2014.stats.totalFlights).toBe(0);
  });

  it("the time series files it on 1 January 2015", async () => {
    const rows = await fetchFlightDatedRows(
      userId,
      new Date("2014-12-01T00:00:00Z"),
      new Date("2015-02-01T00:00:00Z")
    );
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2015-01-01"]);
  });

  it("the flight insights read both ends in 2015, and the flight's times say so", async () => {
    const [row] = await loadFlightInsightRows(userId);
    expect(row.departureDay).toBe("2015-01-01");
    expect(row.arrivalDay).toBe("2015-01-01");
    expect(row.departure?.local.slice(0, 10)).toBe("2015-01-01");
    expect(row.departureDayExact).toBe(false);
  });
});
