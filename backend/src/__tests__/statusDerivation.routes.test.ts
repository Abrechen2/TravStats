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

// Task 5 (spec 2026-07-17-status-from-dates): cruise write paths (create,
// update) derive the temporal status ('scheduled' | 'in_progress' | 'flown')
// from the FINAL startDate/endDate instead of storing the client-sent hint
// verbatim. Passthrough statuses (CRUISE_PASSTHROUGH: cancelled, historical)
// are always assigned verbatim. Unlike flights, the cruise Zod schema has no
// status/date sanity-gate refinement, so a future-dated cruise with a
// 'flown' hint is NOT rejected at create — it reaches route-level derivation
// directly and is overridden to 'scheduled'.
describe("Cruise write paths derive temporal status from dates", () => {
  let authCookie: string;
  let userId: string;

  const daysFromNowIso = (days: number): string =>
    new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    await prisma.cruise.deleteMany({ where: { user: { username: "cruisestatusderive" } } });
    await prisma.user.deleteMany({ where: { username: "cruisestatusderive" } });
    const user = await prisma.user.create({
      data: { username: "cruisestatusderive", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Cruises cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("create: dates spanning now derive 'in_progress' regardless of a 'scheduled' hint", async () => {
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(-3),
        endDate: daysFromNowIso(3),
        status: "scheduled",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("in_progress");

    const stored = await prisma.cruise.findUnique({ where: { id: res.body.data.id } });
    expect(stored?.status).toBe("in_progress");
  });

  it("create: fully past dates (beyond the 48h slack) store 'flown' regardless of a 'scheduled' hint", async () => {
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(-40),
        endDate: daysFromNowIso(-35),
        status: "scheduled",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("flown");
  });

  it("create: a future-dated cruise with a 'flown' hint is not schema-rejected and derives to 'scheduled'", async () => {
    // Unlike flights, the cruise schema has no axis-sanity refinement, so
    // this reaches route-level derivation directly (no 400).
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(10),
        endDate: daysFromNowIso(17),
        status: "flown",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("scheduled");
  });

  it("create: historical is respected verbatim even with future dates", async () => {
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(20),
        endDate: daysFromNowIso(27),
        status: "historical",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("historical");
  });

  it("create: omitting status entirely (schema default 'scheduled') still derives from past dates", async () => {
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(-40),
        endDate: daysFromNowIso(-35),
        // no status field — schema defaults to 'scheduled', which is a
        // non-passthrough hint and must still be overridden by derivation.
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("flown");
  });

  it("update: moving dates into the past re-derives status without a status field", async () => {
    const created = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(32),
        endDate: daysFromNowIso(39),
        status: "scheduled",
      })
      .expect(201);
    expect(created.body.data.status).toBe("scheduled");

    const updated = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({
        startDate: daysFromNowIso(-40),
        endDate: daysFromNowIso(-35),
      })
      .expect(200);

    expect(updated.body.data.status).toBe("flown");
  });

  it("update: a passthrough status (cancelled) is left untouched when dates move to the past without a status field", async () => {
    const created = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(33),
        endDate: daysFromNowIso(40),
        status: "cancelled",
      })
      .expect(201);
    expect(created.body.data.status).toBe("cancelled");

    const updated = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", authCookie)
      .send({
        startDate: daysFromNowIso(-41),
        endDate: daysFromNowIso(-36),
      })
      .expect(200);

    expect(updated.body.data.status).toBe("cancelled");
  });

  it("create: a cruise linked to a trip via tripId recomputes the trip's derived status", async () => {
    const trip = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Cruise-Trip Link — create" })
      .expect(201);
    const tripId = trip.body.trip.id as string;
    // No segments AND no dates on the trip itself, so there is nothing to
    // derive from and the column default applies. That default used to be
    // "completed", which made every hand-made trip start out finished.
    expect(trip.body.trip.status).toBe("planned");

    await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(-3),
        endDate: daysFromNowIso(3),
        status: "scheduled",
        tripId,
      })
      .expect(201);

    const fetched = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(fetched.body.trip.status).toBe("in_progress");
  });

  it("update: linking an existing in-progress-dated cruise to a trip via tripId recomputes the trip", async () => {
    const trip = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Cruise-Trip Link — update" })
      .expect(201);
    const tripId = trip.body.trip.id as string;
    expect(trip.body.trip.status).toBe("planned");

    const cruise = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", authCookie)
      .send({
        cruiseLine: "Status Derive Line",
        startDate: daysFromNowIso(-3),
        endDate: daysFromNowIso(3),
        status: "scheduled",
      })
      .expect(201);

    // Trip has no segments yet — still the column default, unaffected by the
    // cruise that exists but is not linked.
    const beforeLink = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(beforeLink.body.trip.status).toBe("planned");

    await request(app)
      .patch(`/api/v1/cruises/${cruise.body.data.id}`)
      .set("Cookie", authCookie)
      .send({ tripId })
      .expect(200);

    const afterLink = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(afterLink.body.trip.status).toBe("in_progress");
  });
});

// Task 6 (spec 2026-07-17-status-from-dates): trip status derives from the
// date bounds of its linked flights/cruises (`tripDateBounds` +
// `deriveTripStatus`, shared with the sweep). POST /trips itself cannot
// derive anything — a trip has no linked segments until AFTER it exists —
// so creation keeps the client-sent hint (or the schema default) verbatim;
// derivation happens the moment segments get linked via
// `recomputeTripStatus()`. PATCH /trips/:id keeps ACCEPTING a `status`
// field for API compat (never a 400) but ignores it entirely — status is
// never set directly, only derived.
describe("Trip status derives from segment dates", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.trip.deleteMany({ where: { user: { username: "tripstatusderive" } } });
    await prisma.user.deleteMany({ where: { username: "tripstatusderive" } });
    const user = await prisma.user.create({
      data: { username: "tripstatusderive", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Trips/flights cascade from the user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function createFutureFlight(flightNumber: string): Promise<string> {
    const dep = daysFromNow(10);
    const arr = daysFromNow(10, 3);
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        airline: "Lufthansa",
        flightNumber,
        departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
        arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
        depTimezone: "UTC",
        arrTimezone: "UTC",
        departureLocal: isoLocal(dep),
        arrivalLocal: isoLocal(arr),
        status: "scheduled",
      })
      .expect(201);
    return res.body.flight.id as string;
  }

  async function createPastFlight(flightNumber: string): Promise<string> {
    const dep = daysFromNow(-30);
    const arr = daysFromNow(-30, 3);
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", authCookie)
      .send({
        airline: "Lufthansa",
        flightNumber,
        departure: { iata: "FRA", lat: 50.0333, lon: 8.5706 },
        arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
        depTimezone: "UTC",
        arrTimezone: "UTC",
        departureLocal: isoLocal(dep),
        arrivalLocal: isoLocal(arr),
        status: "flown",
      })
      .expect(201);
    return res.body.flight.id as string;
  }

  it("create with linked segments derives: a trip created with the default status flips once a future flight is linked via the bookings route", async () => {
    const created = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Trip Status Derive — bookings link" })
      .expect(201);
    const tripId = created.body.trip.id as string;
    // No segments and no dates, so the column default applies — "planned"
    // now, not "completed": a trip nobody has flown yet is not finished.
    expect(created.body.trip.status).toBe("planned");

    const flightId = await createFutureFlight("LH960");

    await request(app)
      .post("/api/v1/trips/bookings")
      .set("Cookie", authCookie)
      .send({ tripId, flightIds: [flightId] })
      .expect(201);

    const fetched = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(fetched.body.trip.status).toBe("planned");
  });

  it("PATCH sending status is ignored: the stored status is unchanged by a client-sent status field", async () => {
    const created = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Trip Status Derive — PATCH ignored", status: "planned" })
      .expect(201);
    const tripId = created.body.trip.id as string;
    expect(created.body.trip.status).toBe("planned");

    const patched = await request(app)
      .patch(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .send({ status: "completed", name: "Trip Status Derive — PATCH ignored (renamed)" })
      .expect(200);

    // status is ignored entirely — the PATCH must not 400, and the stored
    // value must stay whatever it was before this request.
    expect(patched.body.trip.status).toBe("planned");
    expect(patched.body.trip.name).toBe("Trip Status Derive — PATCH ignored (renamed)");

    const fetched = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(fetched.body.trip.status).toBe("planned");
  });

  it("linking a future flight to a 'completed' trip flips it via the assign-flights route", async () => {
    const created = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Trip Status Derive — assign flights", status: "completed" })
      .expect(201);
    const tripId = created.body.trip.id as string;
    expect(created.body.trip.status).toBe("completed");

    const flightId = await createFutureFlight("LH961");

    await request(app)
      .post(`/api/v1/trips/${tripId}/flights`)
      .set("Cookie", authCookie)
      .send({ flightIds: [flightId], action: "add" })
      .expect(200);

    const fetched = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(fetched.body.trip.status).toBe("planned");
  });

  it("merging trips recomputes the target's derived status from the combined date bounds", async () => {
    // Target starts out with ONLY a past flight — derives to "completed".
    const target = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Trip Status Derive — merge target" })
      .expect(201);
    const targetId = target.body.trip.id as string;

    const pastFlightId = await createPastFlight("LH962");
    await request(app)
      .post(`/api/v1/trips/${targetId}/flights`)
      .set("Cookie", authCookie)
      .send({ flightIds: [pastFlightId], action: "add" })
      .expect(200);

    const targetBeforeMerge = await request(app)
      .get(`/api/v1/trips/${targetId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(targetBeforeMerge.body.trip.status).toBe("completed");

    // Source carries a future flight — derives to "planned" on its own.
    const source = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "Trip Status Derive — merge source" })
      .expect(201);
    const sourceId = source.body.trip.id as string;

    const futureFlightId = await createFutureFlight("LH963");
    await request(app)
      .post(`/api/v1/trips/${sourceId}/flights`)
      .set("Cookie", authCookie)
      .send({ flightIds: [futureFlightId], action: "add" })
      .expect(200);

    // After the merge, the target's combined bounds span past → future, so
    // "now" falls inside them — the derived status must flip to
    // "in_progress". Before the fix, mergeTrips() never called
    // recomputeTripStatus() and the target kept its stale "completed".
    await request(app)
      .post("/api/v1/trips/merge")
      .set("Cookie", authCookie)
      .send({ tripIds: [targetId, sourceId], targetId })
      .expect(200);

    const merged = await request(app)
      .get(`/api/v1/trips/${targetId}`)
      .set("Cookie", authCookie)
      .expect(200);
    expect(merged.body.trip.status).toBe("in_progress");
  });
});
