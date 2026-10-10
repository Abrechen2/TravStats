import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#285 — a booking's deadlines. A booking names no place, so an
 * instant must carry its own zone (a zone-less one is refused, never stored
 * on the server's clock); a day-only deadline stays a floating day.
 */
const USER = "bookingdeadlines";

describe("Bookings — deadlines (forgejo#285)", () => {
  let userId: string;
  let cookie: string;
  let tripId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.booking.deleteMany({ where: { user: { username: USER } } });
    await prisma.rentalBooking.deleteMany({ where: { user: { username: USER } } });
    await prisma.trip.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Lisbon" } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips/bookings").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/trips/bookings/${id}`).set("Cookie", cookie).send(body);

  it("stores a {local, zone} deadline and a payment day, and answers them as times", async () => {
    const res = await create({
      tripId,
      pnr: "ABC123",
      freeCancellationUntil: { local: "2027-05-01T18:00", zone: "Europe/Lisbon" },
      paymentDueOn: "2027-04-15",
    });
    expect(res.status).toBe(201);
    expect(res.body.booking.times.freeCancellationUntil).toMatchObject({
      utc: "2027-05-01T17:00:00.000Z",
      zone: "Europe/Lisbon",
      local: "2027-05-01T18:00:00",
      precision: "minute",
    });
    expect(res.body.booking.times.paymentDue).toEqual({
      date: "2027-04-15",
      zone: null,
      precision: "day",
    });
    expect(res.body.booking.paymentDueOn).toBe("2027-04-15");
    expect(res.body.booking.freeCancellationZone).toBe("Europe/Lisbon");
  });

  it("keeps a day-only deadline as a floating day — a booking names no place", async () => {
    const res = await create({ freeCancellationUntil: "2027-04-30" });
    expect(res.status).toBe(201);
    expect(res.body.booking.times.freeCancellationUntil).toBeNull();
    expect(res.body.booking.times.freeCancellationOn).toEqual({
      date: "2027-04-30",
      zone: null,
      precision: "day",
    });
    expect(res.body.booking.freeCancellationOn).toBe("2027-04-30");
  });

  it("refuses a zone-less instant with 422 TZ_UNRESOLVED", async () => {
    const res = await create({ freeCancellationUntil: "2027-05-01T17:00:00Z" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TZ_UNRESOLVED", field: "freeCancellationUntil" });
  });

  it("refuses an offset-less datetime with 422 TIME_SHAPE_REQUIRED", async () => {
    const res = await create({ freeCancellationUntil: "2027-05-01T18:00" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "freeCancellationUntil" });
  });

  it("refuses a bare {local} — there is no place whose clock it could be", async () => {
    const res = await create({ freeCancellationUntil: { local: "2027-05-01T18:00" } });
    expect(res.status).toBe(400);
  });

  it("leaves the deadlines alone on an unrelated PATCH and clears them on null", async () => {
    const id = (
      await create({
        freeCancellationUntil: { local: "2027-05-01T18:00", zone: "Europe/Lisbon" },
        paymentDueOn: "2027-04-15",
      })
    ).body.booking.id;
    const untouched = await patch(id, { pnr: "XYZ999" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.booking.times.freeCancellationUntil.utc).toBe("2027-05-01T17:00:00.000Z");
    expect(untouched.body.booking.times.paymentDue.date).toBe("2027-04-15");

    const cleared = await patch(id, { freeCancellationUntil: null, paymentDueOn: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.booking.times).toEqual({
      freeCancellationUntil: null,
      freeCancellationOn: null,
      paymentDue: null,
    });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.freeCancellationZone).toBeNull();
  });

  it("serves a booking's deadlines on the trip page", async () => {
    await create({ tripId, paymentDueOn: "2027-03-31" });
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const dues = res.body.trip.bookings.map(
      (b: { times: { paymentDue: { date: string } | null } }) => b.times.paymentDue?.date ?? null
    );
    expect(dues).toContain("2027-03-31");
  });

  it("hands the trip page each rental's deadlines in its times, days as YYYY-MM-DD", async () => {
    await prisma.rentalBooking.create({
      data: {
        userId,
        tripId,
        provider: "Beispiel Autos",
        pickupStationName: "Lisboa Aeroporto",
        pickupLat: 38.77,
        pickupLon: -9.13,
        pickupTimezone: "Europe/Lisbon",
        returnStationName: "Lisboa Aeroporto",
        returnLat: 38.77,
        returnLon: -9.13,
        returnTimezone: "Europe/Lisbon",
        pickupTime: new Date("2027-05-02T09:00:00Z"),
        returnTime: new Date("2027-05-06T09:00:00Z"),
        status: "scheduled",
        freeCancellationOn: new Date("2027-04-30T00:00:00Z"),
        freeCancellationZone: "Europe/Lisbon",
        paymentDueOn: new Date("2027-04-20T00:00:00Z"),
      },
    });
    const res = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie).expect(200);
    const [rental] = res.body.trip.rentalBookings;
    expect(rental.times.freeCancellationOn).toEqual({
      date: "2027-04-30",
      zone: "Europe/Lisbon",
      precision: "day",
    });
    expect(rental.times.paymentDue).toMatchObject({ date: "2027-04-20", zone: null });
    expect(rental.paymentDueOn).toBe("2027-04-20");
  });
});
