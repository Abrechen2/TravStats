/**
 * Every section of `GET /stats/page` equals the endpoint it is named after
 * (forgejo#49).
 *
 * This is the test that makes the composition safe to ship, and it is written
 * the only way that proves anything: both surfaces are fetched in the SAME test
 * against the SAME fixture, and compared. A section that quietly narrowed its
 * population, lost a column, or folded a figure a second way fails here rather
 * than on the page.
 *
 * The existing endpoints are not going anywhere — the Companion reads them and
 * the evidence panel cross-checks against them — so this is a standing
 * agreement between two live surfaces, not a migration check.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { STATS_PAGE_SECTIONS, type StatsPageSection } from "../../schemas/statsPage";

const PER_ENDPOINT_URLS: Record<StatsPageSection, string> = {
  fun: "/api/v1/stats/fun",
  business: "/api/v1/stats/business",
  unique: "/api/v1/stats/unique",
  airports: "/api/v1/stats/airports",
  seats: "/api/v1/stats/seats",
  countries: "/api/v1/stats/countries",
  airlines: "/api/v1/stats/airlines",
  aircraft: "/api/v1/stats/aircraft",
  punctuality: "/api/v1/stats/punctuality",
};

/**
 * A TOTAL order over the two sections that sort on `count` alone.
 *
 * `computeCountryStats` and `computeAircraftRanking` order by count and nothing
 * else, so rows with EQUAL counts come out in whatever order Postgres returned
 * them — and the two surfaces here run two separate queries. The published
 * ordering is deliberately left as it is: adding a tie-break to the endpoints
 * would change what existing clients see, for a reason unrelated to this
 * change. So the COMPARISON imposes the second key instead, on both sides
 * alike, and what it then proves is that the two surfaces hold the same rows.
 */
function byCountThenName<T extends { count: number }>(rows: T[], name: (row: T) => string): T[] {
  return [...rows].sort((a, b) => b.count - a.count || name(a).localeCompare(name(b)));
}

interface CountedCountry {
  country: string;
  count: number;
}
interface CountedHull {
  registration: string;
  count: number;
}

/** One section's body, with any count-only ordering made total. */
function totallyOrdered(section: StatsPageSection, body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  if (section === "countries") {
    const b = body as { countries: CountedCountry[] };
    return { ...b, countries: byCountThenName(b.countries, (r) => r.country) };
  }
  if (section === "aircraft") {
    const b = body as { aircraft: CountedHull[] };
    return { ...b, aircraft: byCountThenName(b.aircraft, (r) => r.registration) };
  }
  return body;
}

describe("GET /api/v1/stats/page — each section equals its own endpoint", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statsPageCrossUser" } });
    const user = await prisma.user.create({
      data: { username: "statsPageCrossUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    // The fixture exercises what the sections actually disagree about if a
    // projection or a predicate drifts:
    //  - two carriers with codes, plus one row with NO airline (the
    //    `flightsWithoutAirline` bucket of forgejo#81);
    //  - a registration on some rows and not others (`/stats/aircraft` narrows
    //    on it in SQL, the composed route filters in JS);
    //  - a delay on some rows and not others (same, for `/stats/punctuality`);
    //  - a `scheduled` row, which is countable by NEITHER surface;
    //  - two currencies, for `/stats/business`;
    //  - seats with and without a parseable number, for `/stats/seats`;
    //  - three countries and three years, for `/stats/countries`.
    await prisma.flight.createMany({
      data: [
        {
          userId,
          flightNumber: "LH400",
          depIata: "MUC",
          arrIata: "JFK",
          depLat: 48.35,
          depLon: 11.78,
          arrLat: 40.64,
          arrLon: -73.78,
          airline: "Lufthansa",
          airlineIata: "LH",
          aircraft: "Airbus A350-900",
          aircraftRegistration: "D-AIXA",
          seatNumber: "12A",
          seatClass: "economy",
          category: "leisure",
          status: "flown",
          delayMinutes: 12,
          departureTime: new Date(Date.UTC(2026, 0, 4, 8, 0, 0)),
          arrivalTime: new Date(Date.UTC(2026, 0, 4, 18, 30, 0)),
          price: 512.5,
          taxes: 60,
          fees: 12,
          currency: "EUR",
        },
        {
          userId,
          flightNumber: "LH401",
          depIata: "JFK",
          arrIata: "MUC",
          depLat: 40.64,
          depLon: -73.78,
          arrLat: 48.35,
          arrLon: 11.78,
          // Deliberately a different spelling of the same carrier — the group
          // key is the CODE, so this must not become a second airline.
          airline: "Deutsche Lufthansa",
          airlineIata: "LH",
          aircraft: "Airbus A350-900",
          aircraftRegistration: "D-AIXA",
          seatNumber: "2C",
          seatClass: "economy",
          category: "leisure",
          status: "flown",
          delayMinutes: 0,
          departureTime: new Date(Date.UTC(2026, 0, 18, 17, 45, 0)),
          arrivalTime: new Date(Date.UTC(2026, 0, 19, 7, 20, 0)),
          price: 498,
          currency: "USD",
        },
        {
          userId,
          flightNumber: "BA11",
          depIata: "LHR",
          arrIata: "SIN",
          depLat: 51.47,
          depLon: -0.4614,
          arrLat: 1.3644,
          arrLon: 103.9915,
          airline: "British Airways",
          airlineIcao: "BAW",
          aircraft: "Boeing 777-300ER",
          seatNumber: "62F",
          seatClass: "business",
          category: "business",
          status: "historical",
          delayMinutes: 95,
          departureTime: new Date(Date.UTC(2025, 5, 9, 21, 10, 0)),
          arrivalTime: new Date(Date.UTC(2025, 5, 10, 17, 5, 0)),
          price: 2240,
          currency: "GBP",
        },
        {
          userId,
          flightNumber: null,
          depIata: "TXL",
          arrIata: "MUC",
          depLat: 52.5597,
          depLon: 13.2877,
          arrLat: 48.35,
          arrLon: 11.78,
          airline: null,
          // No seat number at all; an unparseable one is the next row.
          seatClass: "economy",
          status: "flown",
          departureTime: new Date(Date.UTC(2024, 2, 4, 6, 30, 0)),
          arrivalTime: new Date(Date.UTC(2024, 2, 4, 7, 40, 0)),
        },
        {
          userId,
          flightNumber: "XX1",
          depIata: "MUC",
          arrIata: "TXL",
          depLat: 48.35,
          depLon: 11.78,
          arrLat: 52.5597,
          arrLon: 13.2877,
          airline: "Some Charter",
          seatNumber: "flex",
          status: "historical",
          departureTime: new Date(Date.UTC(2024, 2, 8, 19, 15, 0)),
          arrivalTime: new Date(Date.UTC(2024, 2, 8, 20, 25, 0)),
        },
        {
          userId,
          flightNumber: "LH999",
          depIata: "MUC",
          arrIata: "FRA",
          depLat: 48.35,
          depLon: 11.78,
          arrLat: 50.0379,
          arrLon: 8.5622,
          airline: "Lufthansa",
          airlineIata: "LH",
          aircraftRegistration: "D-AIZZ",
          seatNumber: "1A",
          status: "scheduled",
          delayMinutes: 500,
          departureTime: new Date(Date.UTC(2027, 3, 3, 9, 0, 0)),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statsPageCrossUser" } });
  });

  it("answers every section named in the section list", async () => {
    const res = await request(app)
      .get(`/api/v1/stats/page?include=${STATS_PAGE_SECTIONS.join(",")}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...STATS_PAGE_SECTIONS].sort());
  });

  // One case per section, so a failure names which figure drifted rather than
  // printing nine payloads at once.
  it.each(STATS_PAGE_SECTIONS)("section %s equals its own endpoint", async (section) => {
    const composed = await request(app)
      .get(`/api/v1/stats/page?include=${section}`)
      .set("Cookie", cookie);
    const direct = await request(app).get(PER_ENDPOINT_URLS[section]).set("Cookie", cookie);
    expect(composed.status).toBe(200);
    expect(direct.status).toBe(200);
    expect(totallyOrdered(section, composed.body[section])).toEqual(
      totallyOrdered(section, direct.body)
    );
  });

  it("asking for all nine at once gives what asking for each alone gives", async () => {
    const composed = await request(app)
      .get(`/api/v1/stats/page?include=${STATS_PAGE_SECTIONS.join(",")}`)
      .set("Cookie", cookie);
    expect(composed.status).toBe(200);

    // A section must not be affected by its neighbours sharing its rows.
    for (const section of STATS_PAGE_SECTIONS) {
      const direct = await request(app).get(PER_ENDPOINT_URLS[section]).set("Cookie", cookie);
      expect(totallyOrdered(section, composed.body[section])).toEqual(
        totallyOrdered(section, direct.body)
      );
    }
  });

  it("orders countries identically once both sides are totally ordered", async () => {
    const composed = await request(app)
      .get("/api/v1/stats/page?include=countries")
      .set("Cookie", cookie);
    const direct = await request(app).get(PER_ENDPOINT_URLS.countries).set("Cookie", cookie);
    expect(composed.status).toBe(200);
    expect(direct.status).toBe(200);

    expect(totallyOrdered("countries", composed.body.countries)).toEqual(
      totallyOrdered("countries", direct.body)
    );
    // The tie is real, so the guard above is not vacuous.
    const counts = (direct.body.countries as CountedCountry[]).map((r) => r.count);
    expect(new Set(counts).size).toBeLessThan(counts.length);
  });

  it("excludes the scheduled flight from both surfaces alike", async () => {
    const composed = await request(app)
      .get("/api/v1/stats/page?include=airlines,aircraft,countries")
      .set("Cookie", cookie);
    expect(composed.status).toBe(200);
    // Five countable rows of six. `total` is the ATTRIBUTED count, so the
    // nameless row is outside it too: five minus one.
    expect(composed.body.airlines.total).toBe(4);
    expect(composed.body.airlines.flightsWithoutAirline).toBe(1);
    expect(composed.body.countries.total).toBe(5);
    // D-AIZZ flies only the scheduled leg and must not appear as a hull.
    expect(
      composed.body.aircraft.aircraft.map((a: { registration: string }) => a.registration)
    ).toEqual(["D-AIXA"]);
  });
});
