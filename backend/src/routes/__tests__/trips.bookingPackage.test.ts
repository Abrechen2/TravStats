import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { computeSummary } from "../../services/stats/summary";
import { loadLodgingStatsData } from "../../services/stats/lodgingStatsData";
import { TRIP_COST_SELECT, toTripCostInput } from "../../services/trip/tripCostLoad";
import { tripCostItems } from "../../shared/tripCost";
import { AVAILABLE_DOMAINS } from "../../shared/domains";

/**
 * forgejo#430 end to end: one booking sells a flight, a hotel stay and a
 * rental for 2,870.96 EUR. The trip pays it once; the flight statistics never
 * report it as a flight price, and read the flight's share once split.
 */
const stamp = Date.now();

describe("a booking as a package (forgejo#430)", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let bookingId: string;
  let flightId: string;
  let stayId: string;
  let rentalId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `pkgb-${stamp}`, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Washington", color: "#000000" } }))
      .id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: "LH 418",
          depIata: "FRA",
          arrIata: "IAD",
          depLat: 50.03,
          depLon: 8.57,
          arrLat: 38.95,
          arrLon: -77.45,
          depTimezone: "Europe/Berlin",
          departureTime: new Date("2025-05-01T08:00:00Z"),
          arrivalTime: new Date("2025-05-01T17:00:00Z"),
          status: "flown",
          tripId,
        },
      })
    ).id;
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Capitol" } });
    stayId = (
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkIn: new Date("2025-05-01T00:00:00Z"),
          checkOut: new Date("2025-05-05T00:00:00Z"),
          nights: 4,
          status: "completed",
          tripId,
        },
      })
    ).id;
    rentalId = (
      await prisma.rentalBooking.create({
        data: {
          userId,
          provider: "Hertz",
          pickupStationName: "IAD",
          pickupLat: 38.95,
          pickupLon: -77.45,
          pickupTimezone: "America/New_York",
          returnStationName: "IAD",
          returnLat: 38.95,
          returnLon: -77.45,
          returnTimezone: "America/New_York",
          pickupTime: new Date("2025-05-01T19:00:00Z"),
          returnTime: new Date("2025-05-05T12:00:00Z"),
          status: "completed",
          price: 310,
          currency: "EUR",
          tripId,
        },
      })
    ).id;
    const created = await request(app)
      .post("/api/v1/trips/bookings")
      .set("Cookie", cookie)
      .send({ tripId, pnr: "OPODO1", price: 2870.96, currency: "EUR" })
      .expect(201);
    bookingId = created.body.booking.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const tripTotal = async () => {
    const row = await prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: TRIP_COST_SELECT,
    });
    return tripCostItems(toTripCostInput(row, new Set(AVAILABLE_DOMAINS)));
  };
  const flightYear = () => computeSummary({ userId }, "EUR");

  it("files a flight, a stay and a rental on one booking", async () => {
    const res = await request(app)
      .put(`/api/v1/trips/bookings/${bookingId}/entries`)
      .set("Cookie", cookie)
      .send({ flightIds: [flightId], stayIds: [stayId], rentalIds: [rentalId] })
      .expect(200);
    expect(res.body).toMatchObject({ flights: 1, stays: 1, rentals: 1 });
    const rental = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: rentalId } });
    expect(rental.bookingId).toBe(bookingId);
  });

  it("lists every item, says it is a package, and that nothing is split", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.isPackage).toBe(true);
    expect(res.body.split).toBeNull();
    expect(res.body.items.map((i: { kind: string; share: unknown }) => [i.kind, i.share])).toEqual([
      ["stay", null],
      ["flight", null],
      ["rental", null],
    ]);
  });

  it("the trip pays the package once — the rental's own price is not added on top", async () => {
    const { items } = await tripTotal();
    expect(items.map((i) => i.amount)).toEqual([2870.96]);
  });

  it("the year's flight cost abstains for an unsplit package flight", async () => {
    const { stats } = await flightYear();
    expect(stats.totalCost).toBeNull();
    expect(stats.packagedFlights).toBe(1);
    expect(stats.unpricedFlights).toBe(0);
  });

  it("refuses manual amounts that do not add up to the total", async () => {
    const res = await request(app)
      .put(`/api/v1/trips/bookings/${bookingId}/split`)
      .set("Cookie", cookie)
      .send({
        method: "manual",
        shares: [
          { kind: "flight", id: flightId, amount: 900 },
          { kind: "stay", id: stayId, amount: 1600 },
          { kind: "rental", id: rentalId, amount: 370 },
        ],
      })
      .expect(422);
    expect(res.body.code).toBe("BOOKING_SPLIT_SUM");
  });

  it("splits manually; the flight and stay statistics read their shares, the trip still once", async () => {
    const res = await request(app)
      .put(`/api/v1/trips/bookings/${bookingId}/split`)
      .set("Cookie", cookie)
      .send({
        method: "manual",
        shares: [
          { kind: "flight", id: flightId, amount: 900 },
          { kind: "stay", id: stayId, amount: 1600.96 },
          { kind: "rental", id: rentalId, amount: 370 },
        ],
      })
      .expect(200);
    const shares = res.body.items.map((i: { share: number }) => i.share);
    expect(shares).toEqual([1600.96, 900, 370]);
    expect(Math.round(shares.reduce((a: number, s: number) => a + s, 0) * 100)).toBe(287096);

    const { stats } = await flightYear();
    expect(stats.totalCost).toBe(900);
    expect(stats.packagedFlights).toBe(0);

    const lodging = await loadLodgingStatsData(userId, undefined);
    expect(lodging.stays[0].totalPrice).toBe(1600.96);

    const { items } = await tripTotal();
    expect(items.map((i) => i.amount)).toEqual([2870.96]);
  });

  it("a price change makes the split stale, and the flight abstains again", async () => {
    await request(app)
      .patch(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", cookie)
      .send({ price: 2999 })
      .expect(200);
    const res = await request(app)
      .get(`/api/v1/trips/bookings/${bookingId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.split.staleReason).toBe("price");
    expect(res.body.items.every((i: { share: unknown }) => i.share === null)).toBe(true);
    expect((await flightYear()).stats.packagedFlights).toBe(1);
  });

  it("removing the split goes back to 'not split'", async () => {
    const res = await request(app)
      .delete(`/api/v1/trips/bookings/${bookingId}/split`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.split).toBeNull();
  });

  it("a stranger's booking is not found", async () => {
    const other = await prisma.user.create({
      data: { username: `pkgb-x-${stamp}`, passwordHash: "x" },
    });
    try {
      await request(app)
        .get(`/api/v1/trips/bookings/${bookingId}`)
        .set("Cookie", `auth_token=${generateToken(other.id)}`)
        .expect(404);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});
