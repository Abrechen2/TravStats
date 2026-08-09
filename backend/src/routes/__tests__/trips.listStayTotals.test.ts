import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Third round of the same bug: the trip LIST payload carried price fields for
 * flights and cruises but not for lodging stays, so the card excluded hotels
 * from the total while the detail page counted them — two different sums for
 * the same trip, depending on which screen you looked at.
 *
 * This pins the payload the card needs, exactly as trips.listCruiseTotals.test
 * does for cruises.
 */
describe("the trip list carries stay price fields", () => {
  let authCookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripStayTotals" } });
    const user = await prisma.user.create({
      data: {
        username: "tripStayTotals",
        passwordHash: await hashPassword("password123"),
      },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;

    const trip = await prisma.trip.create({
      data: { userId: user.id, name: "Hotel-only trip", status: "completed" },
    });
    tripId = trip.id;

    const lodging = await prisma.lodging.create({
      data: { userId: user.id, name: "Test Hotel", type: "hotel" },
    });

    await prisma.lodgingStay.create({
      data: {
        userId: user.id,
        lodgingId: lodging.id,
        tripId,
        checkIn: new Date("2026-05-01T00:00:00.000Z"),
        checkOut: new Date("2026-05-04T00:00:00.000Z"),
        status: "completed",
        totalPrice: 420,
        currency: "EUR",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripStayTotals" } });
  });

  it("ships totalPrice, currency and bookingId for each stay", async () => {
    const res = await request(app).get("/api/v1/trips").set("Cookie", authCookie);
    expect(res.status).toBe(200);

    const trip = (res.body.trips ?? res.body).find(
      (entry: { id: string }) => entry.id === tripId
    );
    expect(trip).toBeDefined();
    expect(trip.lodgingStays).toHaveLength(1);
    expect(trip.lodgingStays[0]).toMatchObject({
      totalPrice: 420,
      currency: "EUR",
      bookingId: null,
    });
  });
});
