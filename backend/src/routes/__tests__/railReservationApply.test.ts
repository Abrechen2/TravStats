import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { DB_RESERVATION_MAIL } from "../../services/rail/parser/__tests__/railReservationFixtures";

/**
 * forgejo#203 end to end on the server: a reservation mail through the
 * ordinary parse route comes back as a reservation for the user's logged
 * journey, and the seat is applied through the ordinary rail update — which
 * writes the coach and seat and nothing else, and only on the owner's row.
 */
describe("a later seat reservation, parsed and applied", () => {
  let userId: string;
  let cookie: string;
  let otherCookie: string;
  let otherId: string;
  let journeyId: string;
  const previousOllama = process.env.OLLAMA_URL;

  beforeAll(async () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:9";
    const stamp = Date.now();
    const make = async (name: string) =>
      prisma.user.create({
        data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("test-password") },
      });
    const user = await make("rail-res-apply");
    const other = await make("rail-res-apply-other");
    userId = user.id;
    otherId = other.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    journeyId = (
      await prisma.railJourney.create({
        data: {
          userId,
          trainCategory: "ICE",
          trainNumber: "615",
          depStationName: "Musterstadt Hbf",
          depLat: 50.1,
          depLon: 8.6,
          depTimezone: "Europe/Berlin",
          arrStationName: "Beispielburg Hbf",
          arrLat: 48.4,
          arrLon: 10.9,
          arrTimezone: "Europe/Berlin",
          // 19:55 and 23:58 in Berlin in April are 17:55 and 21:58 UTC.
          departureTime: new Date("2026-04-19T17:55:00Z"),
          arrivalTime: new Date("2026-04-19T21:58:00Z"),
          bookingReference: "910987654321",
        },
      })
    ).id;
  });

  afterAll(async () => {
    process.env.OLLAMA_URL = previousOllama;
    await prisma.railJourney.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("answers the reservation mail with the journey it belongs to, and creates nothing", async () => {
    const res = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: DB_RESERVATION_MAIL, domain: "rail" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ domain: "rail", parserUsed: "template" });
    const [booking] = res.body.bookings;
    expect(booking.documentKind).toBe("reservation");
    expect(booking.legs[0].reservation).toMatchObject({
      kind: "attach",
      subSection: false,
      target: { id: journeyId, coach: null, seat: null },
    });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("writes only the coach and seat through the rail update", async () => {
    const before = await prisma.railJourney.findUniqueOrThrow({ where: { id: journeyId } });
    const res = await request(app)
      .patch(`/api/v1/rail/${journeyId}`)
      .set("Cookie", cookie)
      .send({ coach: "12", seat: "133" });

    expect(res.status).toBe(200);
    const after = await prisma.railJourney.findUniqueOrThrow({ where: { id: journeyId } });
    expect(after).toMatchObject({ coach: "12", seat: "133" });
    expect(after.departureTime.toISOString()).toBe(before.departureTime.toISOString());
    expect(after.arrivalTime?.toISOString()).toBe(before.arrivalTime?.toISOString());
    expect([after.trainNumber, after.bookingReference, after.geometrySource]).toEqual([
      before.trainNumber,
      before.bookingReference,
      before.geometrySource,
    ]);

    // Parsed again, the same reservation now finds its seat already there.
    const again = await request(app)
      .post("/api/v1/parse-email")
      .set("Cookie", cookie)
      .send({ emailContent: DB_RESERVATION_MAIL, domain: "rail" });
    expect(again.body.bookings[0].legs[0].reservation.kind).toBe("alreadySet");
  });

  it("refuses to apply a seat to another user's journey", async () => {
    const res = await request(app)
      .patch(`/api/v1/rail/${journeyId}`)
      .set("Cookie", otherCookie)
      .send({ coach: "1", seat: "1" });
    expect(res.status).toBe(404);
    const row = await prisma.railJourney.findUniqueOrThrow({ where: { id: journeyId } });
    expect(row).toMatchObject({ coach: "12", seat: "133" });
  });
});
