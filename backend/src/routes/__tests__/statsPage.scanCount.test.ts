/**
 * `GET /stats/page` performs ONE pass over the flight table where the fan-out
 * performed thirteen (forgejo#49).
 *
 * The saving is asserted as a NUMBER, not as a claim: the same test drives the
 * nine per-endpoint routes first and counts their queries against the `Flight`
 * model, then drives the composed endpoint over the identical fixture and
 * counts again. If a section ever re-queries — which is the one way this
 * endpoint could be written and save nothing — the second count moves and this
 * fails.
 *
 * The spy is `observeQueries` — the seam that replaced Prisma's removed
 * `$use` middleware — rather than a `jest.spyOn` on `prisma.flight.findMany`,
 * so it also sees the queries the services beneath the handlers perform.
 */
import request from "supertest";
import app from "../../index";
import { observeQueries, prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { STATS_PAGE_SECTIONS } from "../../schemas/statsPage";

/** The nine endpoints `/stats/page` composes, in the order of the section list. */
const PER_ENDPOINT_URLS: Record<string, string> = {
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

interface FlightQuery {
  action: string;
}

const observed: FlightQuery[] = [];
let recording = false;

observeQueries(({ model, operation }) => {
  if (recording && model === "Flight") observed.push({ action: operation });
});

/** Run `fn` with the spy on and return every `Flight` query it caused. */
async function countFlightQueries(fn: () => Promise<unknown>): Promise<FlightQuery[]> {
  observed.length = 0;
  recording = true;
  try {
    await fn();
  } finally {
    recording = false;
  }
  return [...observed];
}

const scans = (queries: FlightQuery[]): number =>
  queries.filter((q) => q.action === "findMany").length;

describe("GET /api/v1/stats/page — one scan instead of thirteen", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statsPageScanUser" } });
    const user = await prisma.user.create({
      data: { username: "statsPageScanUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    // A fixture with something for every section: two carriers, two hulls, a
    // delay on each row, seats, prices, and one row with no airline at all so
    // `flightsWithoutAirline` is not trivially zero.
    await prisma.flight.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, i) => ({
          userId,
          flightNumber: `LH${100 + i}`,
          depIata: "MUC",
          arrIata: "JFK",
          depLat: 48.35,
          depLon: 11.78,
          arrLat: 40.64,
          arrLon: -73.78,
          airline: "Lufthansa",
          airlineIata: "LH",
          aircraft: "Airbus A350",
          aircraftRegistration: "D-AIXA",
          seatNumber: `1${i}A`,
          seatClass: "economy",
          status: "flown",
          delayMinutes: i * 4,
          departureTime: new Date(Date.UTC(2026, 0, 1 + i, 8, 0, 0)),
          arrivalTime: new Date(Date.UTC(2026, 0, 1 + i, 18, 0, 0)),
          price: 400 + i,
          currency: "EUR",
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          userId,
          flightNumber: `BA${200 + i}`,
          depIata: "LHR",
          arrIata: "SIN",
          depLat: 51.47,
          depLon: -0.4614,
          arrLat: 1.3644,
          arrLon: 103.9915,
          airline: "British Airways",
          airlineIata: "BA",
          aircraft: "Boeing 777-300ER",
          aircraftRegistration: "G-STBA",
          seatNumber: `3${i}K`,
          seatClass: "business",
          status: "historical",
          delayMinutes: 60 + i,
          departureTime: new Date(Date.UTC(2025, 5, 1 + i, 21, 0, 0)),
          arrivalTime: new Date(Date.UTC(2025, 5, 2 + i, 17, 0, 0)),
          price: 2200,
          currency: "EUR",
        })),
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
          status: "flown",
          departureTime: new Date(Date.UTC(2024, 2, 4, 6, 30, 0)),
          arrivalTime: new Date(Date.UTC(2024, 2, 4, 7, 40, 0)),
        },
        // Not countable: must appear in NEITHER surface's population.
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
          status: "scheduled",
          departureTime: new Date(Date.UTC(2027, 3, 3, 9, 0, 0)),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statsPageScanUser" } });
  });

  it("the nine per-endpoint requests cost eight scans; the composed one costs one", async () => {
    const perEndpoint = await countFlightQueries(async () => {
      for (const section of STATS_PAGE_SECTIONS) {
        const res = await request(app).get(PER_ENDPOINT_URLS[section]).set("Cookie", cookie);
        expect(res.status).toBe(200);
      }
    });

    // Eight of the nine load rows; `/stats/airlines` reaches its answer with a
    // `count` plus a `groupBy` instead. Measured 2026-09-19 — the number is
    // here so a regression that reintroduces a scan is a failing test, not a
    // slower page.
    expect(scans(perEndpoint)).toBe(8);
    expect(perEndpoint.length).toBe(10);

    const composed = await countFlightQueries(async () => {
      const res = await request(app)
        .get(`/api/v1/stats/page?include=${STATS_PAGE_SECTIONS.join(",")}`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
    });

    // ONE query against the flight table for all nine sections. Not "fewer" —
    // one. Anything else means a section went back to the database.
    expect(composed).toEqual([{ action: "findMany" }]);
  });

  it("asks for only what `include` names, and still only scans once", async () => {
    const composed = await countFlightQueries(async () => {
      const res = await request(app).get("/api/v1/stats/page?include=seats").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(["seats"]);
    });
    expect(composed).toEqual([{ action: "findMany" }]);
  });

  it("rejects an unknown section rather than answering without it", async () => {
    const res = await request(app)
      .get("/api/v1/stats/page?include=seats,telepathy")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  // The endpoint takes NO date range: four of its nine sections have none on
  // their own endpoint, so a range would narrow five and leave four at all
  // time. Stripping the parameter would let a caller believe it had scoped the
  // answer — hence `.strict()`.
  it("rejects a date range rather than ignoring it", async () => {
    const res = await request(app)
      .get("/api/v1/stats/page?include=seats&fromDate=2026-01-01")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("rejects an empty include rather than composing everything", async () => {
    expect((await request(app).get("/api/v1/stats/page").set("Cookie", cookie)).status).toBe(400);
    expect(
      (await request(app).get("/api/v1/stats/page?include=").set("Cookie", cookie)).status
    ).toBe(400);
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/v1/stats/page?include=seats")).status).toBe(401);
  });
});
