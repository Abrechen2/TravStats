import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";

// Task 4 (spec 2026-07-17-status-from-dates): flight write paths (create,
// update, batch) derive the temporal status ('scheduled' | 'flown') from the
// FINAL departure/arrival dates instead of storing the client-sent hint
// verbatim. Passthrough statuses (FLIGHT_PASSTHROUGH: cancelled, historical,
// duplicated) are always assigned verbatim and are never overridden.
//
// Adaptation vs the brief's named cases: "a future-dated flight with a
// 'flown' hint stores scheduled" is not reachable at CREATE — Zod's
// requireStatusTimeAxisSanity (schemas/flight.ts) already rejects
// flown/historical with a future departureLocal at the schema layer with a
// 400, before the route's derivation logic ever runs. That schema-level
// rejection is covered directly (case 2 below). The equivalent *behavioral*
// coverage — a 'flown' hint overridden to 'scheduled' by derivation — is
// exercised on the UPDATE path instead (case 5), where the axis-sanity
// refinement only inspects an incoming `departureLocal`; sending `status`
// alone without date fields bypasses it and reaches the route's derivation.

const isoLocal = (d: Date): string => d.toISOString().slice(0, 16);
const daysFromNow = (days: number, hoursOffset = 0): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hoursOffset * 60 * 60 * 1000);

describe("Flight write paths derive temporal status from dates", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.flight.deleteMany({ where: { user: { username: "statusderivetest" } } });
    await prisma.user.deleteMany({ where: { username: "statusderivetest" } });
    const user = await prisma.user.create({
      data: { username: "statusderivetest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Flights cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function makeFlight(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      airline: "Lufthansa",
      flightNumber: "LH900",
      departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
      arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
      depTimezone: "UTC",
      arrTimezone: "UTC",
      ...overrides,
    };
  }

  it("create: a past-dated flight stores 'flown' regardless of a 'scheduled' hint", async () => {
    const dep = daysFromNow(-30);
    const arr = daysFromNow(-30, 3);
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH901",
          departureLocal: isoLocal(dep),
          arrivalLocal: isoLocal(arr),
          status: "scheduled",
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.flight.status).toBe("flown");

    const stored = await prisma.flight.findUnique({ where: { id: res.body.flight.id } });
    expect(stored?.status).toBe("flown");
  });

  it("create: a future-dated flight with a 'flown' hint is rejected by schema validation (400)", async () => {
    // Adaptation (see header comment): the schema's requireStatusTimeAxisSanity
    // refinement rejects flown/historical + future departureLocal before the
    // route's derivation logic runs — this is pre-existing, unrelated behavior
    // that Task 4 does not change, just documents.
    const dep = daysFromNow(30);
    const arr = daysFromNow(30, 3);
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH902",
          departureLocal: isoLocal(dep),
          arrivalLocal: isoLocal(arr),
          status: "flown",
        }),
      );
    expect(res.status).toBe(400);
  });

  it("create: cancelled is respected verbatim even with future dates", async () => {
    const dep = daysFromNow(31);
    const arr = daysFromNow(31, 3);
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH903",
          departureLocal: isoLocal(dep),
          arrivalLocal: isoLocal(arr),
          status: "cancelled",
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.flight.status).toBe("cancelled");
  });

  it("update: moving the dates to the past flips status to 'flown' without a status field", async () => {
    const futureDep = daysFromNow(32);
    const futureArr = daysFromNow(32, 3);
    const created = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH904",
          departureLocal: isoLocal(futureDep),
          arrivalLocal: isoLocal(futureArr),
          status: "scheduled",
        }),
      )
      .expect(201);
    expect(created.body.flight.status).toBe("scheduled");

    const pastDep = daysFromNow(-31);
    const pastArr = daysFromNow(-31, 3);
    const updated = await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set("Cookie", authCookie)
      .send({
        departureLocal: isoLocal(pastDep),
        depTimezone: "UTC",
        arrivalLocal: isoLocal(pastArr),
        arrTimezone: "UTC",
      })
      .expect(200);

    expect(updated.body.flight.status).toBe("flown");
  });

  it("update: sending status 'flown' on future dates (no date fields) is overridden to 'scheduled'", async () => {
    const futureDep = daysFromNow(33);
    const futureArr = daysFromNow(33, 3);
    const created = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH905",
          departureLocal: isoLocal(futureDep),
          arrivalLocal: isoLocal(futureArr),
          status: "scheduled",
        }),
      )
      .expect(201);

    // No departureLocal/arrivalLocal in this payload — the schema's
    // axis-sanity refinement only checks an incoming departureLocal, so
    // sending status alone bypasses it and reaches route-level derivation,
    // which re-derives from the FINAL (unchanged, still-future) stored dates.
    const updated = await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set("Cookie", authCookie)
      .send({ status: "flown" })
      .expect(200);

    expect(updated.body.flight.status).toBe("scheduled");
  });

  it("update: a passthrough status (cancelled) is left untouched when dates move to the past without a status field", async () => {
    const futureDep = daysFromNow(34);
    const futureArr = daysFromNow(34, 3);
    const created = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send(
        makeFlight({
          flightNumber: "LH906",
          departureLocal: isoLocal(futureDep),
          arrivalLocal: isoLocal(futureArr),
          status: "cancelled",
        }),
      )
      .expect(201);
    expect(created.body.flight.status).toBe("cancelled");

    const pastDep = daysFromNow(-32);
    const pastArr = daysFromNow(-32, 3);
    const updated = await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set("Cookie", authCookie)
      .send({
        departureLocal: isoLocal(pastDep),
        depTimezone: "UTC",
        arrivalLocal: isoLocal(pastArr),
        arrTimezone: "UTC",
      })
      .expect(200);

    expect(updated.body.flight.status).toBe("cancelled");
  });

  it("batch: rows derive like create — a past-dated 'scheduled' hint stores 'flown'", async () => {
    const dep = daysFromNow(-33);
    const arr = daysFromNow(-33, 3);
    const res = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", authCookie)
      .send([
        makeFlight({
          flightNumber: "LH907",
          departureLocal: isoLocal(dep),
          arrivalLocal: isoLocal(arr),
          status: "scheduled",
        }),
      ]);
    expect(res.status).toBe(201);
    expect(res.body.flights[0].status).toBe("flown");

    const stored = await prisma.flight.findUnique({ where: { id: res.body.flights[0].id } });
    expect(stored?.status).toBe("flown");
  });
});
