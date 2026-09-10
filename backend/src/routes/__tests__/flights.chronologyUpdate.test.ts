import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A partial update is judged on what it leaves behind.
 *
 * The Zod schema sees only the body, so a PUT carrying just a departure had
 * nothing to compare it against: moving the departure a day later answered 200
 * and left the arrival sitting in the past. Swapping the string comparison for
 * a real one does not fix this half — the merged end state has to be checked
 * (audit finding AUD-018).
 */
const USERNAME = `flight-chrono-${Date.now()}`;

describe("updating one end of a flight", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  let seq = 0;
  const createFlight = async () => {
    seq += 1;
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({
        // Unique per call: the API refuses a second identical flight on the
        // same day with a 409, which has nothing to do with this test.
        flightNumber: `LH40${seq}`,
        airline: "Lufthansa",
        departure: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
        arrival: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
        departureLocal: "2026-06-01T10:00",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2026-06-01T13:00",
        arrTimezone: "America/New_York",
        status: "scheduled",
      });
    expect(res.status).toBe(201);
    // This router answers BARE (docs/adr/0001-api-response-shape.md), so the
    // flight is the body — `?? res.body` on a `{data}` guess would silently
    // hand back an id of `undefined` and every PUT below would 404.
    const id = (res.body.id ?? res.body.flight?.id ?? res.body.data?.id) as string | undefined;
    expect(typeof id).toBe("string");
    return id!;
  };

  it("refuses a departure moved past the arrival that stays behind", async () => {
    const id = await createFlight();

    const res = await request(app)
      .put(`/api/v1/flights/${id}`)
      .set("Cookie", cookie)
      .send({ departureLocal: "2026-06-02T10:00", depTimezone: "Europe/Berlin" });

    expect(res.status).toBe(400);

    // And nothing was written: the row still holds the day it had.
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(stored.departureTime?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("still allows a departure moved to a time the arrival can follow", async () => {
    // The positive case: without it the assertion above could pass on a route
    // that refuses every one-sided update.
    const id = await createFlight();

    const res = await request(app)
      .put(`/api/v1/flights/${id}`)
      .set("Cookie", cookie)
      .send({ departureLocal: "2026-06-01T11:00", depTimezone: "Europe/Berlin" });

    expect(res.status).toBe(200);
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(stored.departureTime?.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("accepts a westward flight the string comparison used to refuse", async () => {
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({
        flightNumber: "LH900",
        airline: "Lufthansa",
        departure: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
        arrival: { iata: "LHR", name: "London", lat: 51.47, lon: -0.45 },
        departureLocal: "2026-06-01T10:00",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2026-06-01T09:45",
        arrTimezone: "Europe/London",
        status: "scheduled",
      });

    expect(res.status).toBe(201);
  });

  it("refuses an eastward flight that would go backwards in time", async () => {
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({
        flightNumber: "BA990",
        airline: "British Airways",
        departure: { iata: "LHR", name: "London", lat: 51.47, lon: -0.45 },
        arrival: { iata: "BER", name: "Berlin", lat: 52.36, lon: 13.5 },
        departureLocal: "2026-06-01T10:00",
        depTimezone: "Europe/London",
        arrivalLocal: "2026-06-01T10:30",
        arrTimezone: "Europe/Berlin",
        status: "scheduled",
      });

    expect(res.status).toBe(400);
  });
});
