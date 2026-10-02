import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * A rental's trip and roadtrip (spec 2026-10-01-rental-domain-design §7.1,
 * §7.2): overlap suggests, exactly one overlapping trip links by itself, a
 * roadtrip is offered and linked only on the user's word. Invented values.
 */
describe("rental links", () => {
  let cookie: string;
  let userId: string;

  const createRental = (over: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/v1/rentals")
      .set("Cookie", cookie)
      .send({
        provider: "Testcar",
        pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
        pickupLocal: "2026-08-10T10:00",
        returnLocal: "2026-08-14T10:00",
        ...over,
      });

  const trip = (name: string, startDay: string, endDay: string) =>
    prisma.trip.create({
      data: {
        userId,
        name,
        startDay: new Date(`${startDay}T00:00:00Z`),
        endDay: new Date(`${endDay}T00:00:00Z`),
      },
    });

  const roadtrip = (
    vehicle: string,
    first: string,
    last: string,
    vehicleName: string | null = null
  ) =>
    prisma.tripRoute.create({
      data: {
        userId,
        kind: "roadtrip",
        mode: "car",
        name: `Drive ${vehicle}`,
        vehicle,
        vehicleName,
        stops: {
          create: [
            {
              title: "A",
              startDate: new Date(`${first}T00:00:00Z`),
              endDate: new Date(`${first}T00:00:00Z`),
            },
            {
              title: "B",
              startDate: new Date(`${last}T00:00:00Z`),
              endDate: new Date(`${last}T00:00:00Z`),
              orderIdx: 1,
            },
          ],
        },
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentallinks" } });
    const user = await prisma.user.create({
      data: { username: "rentallinks", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await rentalCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("joins the one trip its days overlap by itself", async () => {
    const t = await trip("Summer", "2026-08-08", "2026-08-20");
    const res = await createRental();
    expect(res.body.data.tripId).toBe(t.id);
  });

  it("joins no trip when two overlap, and suggests both", async () => {
    await trip("One", "2026-08-08", "2026-08-11");
    await trip("Two", "2026-08-13", "2026-08-20");
    const rental = (await createRental()).body.data;
    expect(rental.tripId).toBeNull();
    const res = await request(app)
      .get(`/api/v1/rentals/${rental.id}/suggestions`)
      .set("Cookie", cookie);
    expect(res.body.data.trips.map((x: { name: string }) => x.name).sort()).toEqual(["One", "Two"]);
  });

  it("keeps the trip the user chose, even when another overlaps", async () => {
    await trip("Overlapping", "2026-08-08", "2026-08-20");
    const mine = await trip("Mine", "2025-01-01", "2025-01-02");
    const res = await createRental({ tripId: mine.id });
    expect(res.body.data.tripId).toBe(mine.id);
  });

  it("offers a car roadtrip in its days — and never a bike tour — without linking it", async () => {
    const car = await roadtrip("car", "2026-08-11", "2026-08-13");
    await roadtrip("bicycle", "2026-08-11", "2026-08-13");
    await roadtrip("car", "2026-09-01", "2026-09-03");
    const rental = (await createRental()).body.data;
    expect(rental.routeId).toBeNull();
    const res = await request(app)
      .get(`/api/v1/rentals/${rental.id}/suggestions`)
      .set("Cookie", cookie);
    expect(res.body.data.roadtrips.map((r: { id: string }) => r.id)).toEqual([car.id]);
  });

  it("links on confirmation, names an unnamed car after the group, and only offers the stations", async () => {
    const car = await roadtrip("car", "2026-08-11", "2026-08-13");
    const rental = (await createRental({ vehicleClass: "Kompakt" })).body.data;
    const res = await request(app)
      .post(`/api/v1/rentals/${rental.id}/roadtrip`)
      .set("Cookie", cookie)
      .send({ routeId: car.id });
    expect(res.status).toBe(200);
    expect(res.body.data.routeId).toBe(car.id);
    expect(res.body.meta.stationOffer.first.name).toBe("Frankfurt Flughafen");
    const route = await prisma.tripRoute.findUniqueOrThrow({
      where: { id: car.id },
      include: { stops: true },
    });
    expect(route.vehicleName).toBe("Kompakt");
    expect(route.stops).toHaveLength(2);
  });

  it("never renames a car the user named", async () => {
    const car = await roadtrip("car", "2026-08-11", "2026-08-13", "Old faithful");
    const rental = (await createRental({ vehicleClass: "Kompakt" })).body.data;
    await request(app)
      .post(`/api/v1/rentals/${rental.id}/roadtrip`)
      .set("Cookie", cookie)
      .send({ routeId: car.id });
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: car.id } })).vehicleName).toBe(
      "Old faithful"
    );
  });

  it("refuses to make a bike tour the car of a rental", async () => {
    const bike = await roadtrip("bicycle", "2026-08-11", "2026-08-13");
    const rental = (await createRental()).body.data;
    const res = await request(app)
      .post(`/api/v1/rentals/${rental.id}/roadtrip`)
      .set("Cookie", cookie)
      .send({ routeId: bike.id });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RENTAL_ROADTRIP_NOT_FOUND");
  });

  it("extends its trip's status like a flight: a running rental makes the trip run", async () => {
    const t = await prisma.trip.create({ data: { userId, name: "Now" } });
    const now = new Date();
    const day = (offset: number) =>
      new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 16);
    await createRental({ tripId: t.id, pickupLocal: day(-1), returnLocal: day(2) });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: t.id } })).status).toBe(
      "in_progress"
    );
  });
});
