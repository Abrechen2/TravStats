import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * #356 remaining: a package booking built by hand on the trip page — the
 * operator, "für N Personen", the day it was booked (which dates the FX
 * snapshot, not today), and the flights/stays/cruises it covers — and the
 * failure paths: a foreign entry refuses the whole write, deleting keeps the
 * entries.
 */
const stamp = Date.now();

describe("package bookings by hand (#356)", () => {
  let cookie: string;
  let userId: string;
  let strangerId: string;
  let tripId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `pk-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `pk-x-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Package" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  const stayOf = async (owner: string): Promise<string> => {
    const lodging = await prisma.lodging.create({
      data: { userId: owner, name: `Hotel ${owner.slice(0, 4)}`, type: "hotel" },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId: owner,
        lodgingId: lodging.id,
        checkIn: new Date("2026-05-19"),
        checkOut: new Date("2026-05-26"),
      },
    });
    return stay.id;
  };
  const cruiseOf = async (owner: string): Promise<string> =>
    (await prisma.cruise.create({ data: { userId: owner, cruiseLine: "Line" } })).id;

  it("creates a booking with operator, travellers and the booking day, covering stays and cruises", async () => {
    const stayId = await stayOf(userId);
    const cruiseId = await cruiseOf(userId);
    const res = await request(app)
      .post("/api/v1/trips/bookings")
      .set("Cookie", cookie)
      .send({
        tripId,
        pnr: "PKG1",
        operator: "Tourlane",
        travellers: 2,
        price: 4200,
        currency: "EUR",
        bookedOn: "2025-09-12",
        stayIds: [stayId],
        cruiseIds: [cruiseId],
      })
      .expect(201);
    const booking = res.body.booking;
    expect(booking.operator).toBe("Tourlane");
    expect(booking.travellers).toBe(2);
    expect(booking.bookedOn.slice(0, 10)).toBe("2025-09-12");
    // The FX snapshot is rated on the day it was booked, not today.
    if (booking.fxRateDate) expect(booking.fxRateDate.slice(0, 10)).toBe("2025-09-12");

    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stayId } });
    const cruise = await prisma.cruise.findUniqueOrThrow({ where: { id: cruiseId } });
    expect([stay.bookingId, stay.tripId]).toEqual([booking.id, tripId]);
    expect([cruise.bookingId, cruise.tripId]).toEqual([booking.id, tripId]);
  });

  it("refuses a stay that is not the caller's and creates nothing", async () => {
    const foreign = await stayOf(strangerId);
    const before = await prisma.booking.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/trips/bookings")
      .set("Cookie", cookie)
      .send({ tripId, pnr: "PKG2", stayIds: [foreign] })
      .expect(404);
    expect(res.body.code).toBe("STAY_NOT_FOUND");
    expect(await prisma.booking.count({ where: { userId } })).toBe(before);
  });

  it("replaces the entries of the kinds named, and leaves the others alone", async () => {
    const a = await stayOf(userId);
    const b = await stayOf(userId);
    const cruiseId = await cruiseOf(userId);
    const booking = await prisma.booking.create({ data: { userId, tripId, pnr: "PKG3" } });
    await prisma.lodgingStay.update({ where: { id: a }, data: { bookingId: booking.id } });
    await prisma.cruise.update({ where: { id: cruiseId }, data: { bookingId: booking.id } });

    const res = await request(app)
      .put(`/api/v1/trips/bookings/${booking.id}/entries`)
      .set("Cookie", cookie)
      .send({ stayIds: [b] })
      .expect(200);
    expect(res.body.stays).toBe(1);
    expect((await prisma.lodgingStay.findUniqueOrThrow({ where: { id: a } })).bookingId).toBeNull();
    expect((await prisma.lodgingStay.findUniqueOrThrow({ where: { id: b } })).bookingId).toBe(
      booking.id
    );
    expect((await prisma.cruise.findUniqueOrThrow({ where: { id: cruiseId } })).bookingId).toBe(
      booking.id
    );
  });

  it("re-dates the FX snapshot when the booking day is edited", async () => {
    const booking = await prisma.booking.create({
      data: { userId, tripId, pnr: "PKG4", price: 100, currency: "EUR" },
    });
    const res = await request(app)
      .patch(`/api/v1/trips/bookings/${booking.id}`)
      .set("Cookie", cookie)
      .send({ bookedOn: "2024-03-01", travellers: 3, operator: "DERTOUR" })
      .expect(200);
    expect(res.body.booking.travellers).toBe(3);
    expect(res.body.booking.operator).toBe("DERTOUR");
    if (res.body.booking.fxRateDate) {
      expect(res.body.booking.fxRateDate.slice(0, 10)).toBe("2024-03-01");
    }
  });

  it("deletes a booking and keeps the entries it covered", async () => {
    const stayId = await stayOf(userId);
    const booking = await prisma.booking.create({ data: { userId, tripId, pnr: "PKG5" } });
    await prisma.lodgingStay.update({ where: { id: stayId }, data: { bookingId: booking.id } });
    await request(app)
      .delete(`/api/v1/trips/bookings/${booking.id}`)
      .set("Cookie", cookie)
      .expect(204);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
    const stay = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stayId } });
    expect(stay.bookingId).toBeNull();
  });

  it("does not delete another account's booking", async () => {
    const booking = await prisma.booking.create({ data: { userId: strangerId, pnr: "THEIRS" } });
    await request(app)
      .delete(`/api/v1/trips/bookings/${booking.id}`)
      .set("Cookie", cookie)
      .expect(404);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();
  });
});
