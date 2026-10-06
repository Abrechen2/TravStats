import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * forgejo#206: the odometer at pick-up and at return. Both readings travel
 * through the write body and back; both known give the driven km (in − out)
 * wherever km are read — the row's reminder flag, the reminder list and the
 * statistics — unless a stored figure (invoice or hand correction) wins; and a
 * return reading below the pick-up one is refused with a stable field error,
 * also when only one of the two is patched. Every value is invented.
 */
describe("rental odometer readings (forgejo#206)", () => {
  let cookie: string;
  let userId: string;

  const H = 3_600_000;
  const base = {
    provider: "Testcar",
    pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
    pickupLocal: "2025-07-01T10:00",
    returnLocal: "2025-07-05T09:30",
  };
  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  /** A row written directly, so it can sit in the past as a returned rental. */
  const stored = (over: Record<string, unknown>) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Testcar",
        pickupStationName: "Testport",
        pickupLat: 50.03,
        pickupLon: 8.57,
        pickupTimezone: "Europe/Berlin",
        returnStationName: "Testport",
        returnLat: 50.03,
        returnLon: 8.57,
        returnTimezone: "Europe/Berlin",
        pickupTime: new Date(Date.now() - 72 * H),
        returnTime: new Date(Date.now() - 24 * H),
        status: "completed",
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentalodometer" } });
    const user = await prisma.user.create({
      data: { username: "rentalodometer", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await rentalCreationLimiter.resetKey(`user:${userId}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("stores both readings and hands them back; the stored km stay untouched", async () => {
    const res = await create({ ...base, odometerOutKm: 12_000, odometerInKm: 12_634 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      odometerOutKm: 12_000,
      odometerInKm: 12_634,
      // The derivation is read, not written: no figure is invented on the row.
      distanceKm: null,
      distanceSource: null,
      status: "completed",
      invoiceMissing: false,
    });
    const id = res.body.data.id;
    const read = await request(app).get(`/api/v1/rentals/${id}`).set("Cookie", cookie);
    expect(read.body.data).toMatchObject({ odometerOutKm: 12_000, odometerInKm: 12_634 });
  });

  it("clears a reading with null, and one reading alone gives no km", async () => {
    const res = await create({ ...base, odometerOutKm: 12_000, odometerInKm: 12_634 });
    const cleared = await patch(res.body.data.id, { odometerInKm: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ odometerOutKm: 12_000, odometerInKm: null });
    // Returned (the booked return is past) and only half a pair: km still owed.
    expect(cleared.body.data.invoiceMissing).toBe(true);
  });

  it("refuses a return reading below the pick-up one, naming the field", async () => {
    const res = await create({ ...base, odometerOutKm: 12_634, odometerInKm: 12_000 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "RENTAL_ODOMETER_REVERSED", field: "odometerInKm" });
    expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
  });

  it("holds a one-reading PATCH against the stored other", async () => {
    const res = await create({ ...base, odometerOutKm: 12_000 });
    const id = res.body.data.id;
    const refused = await patch(id, { odometerInKm: 11_999 });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "RENTAL_ODOMETER_REVERSED", field: "odometerInKm" });
    const row = await prisma.rentalBooking.findUniqueOrThrow({ where: { id } });
    expect(row.odometerInKm).toBeNull();
    // Equal is a real (zero) distance, not a reversal.
    expect((await patch(id, { odometerInKm: 12_000 })).status).toBe(200);
  });

  it("does not refuse an unrelated edit of a row whose stored pair is reversed", async () => {
    // An invoice may carry such a pair; the form never could.
    const row = await stored({ odometerOutKm: 500, odometerInKm: 400 });
    const res = await patch(row.id, { notes: "returned with a full tank" });
    expect(res.status).toBe(200);
  });

  it("counts in − out in the statistics, and lets a stored figure win over it", async () => {
    await stored({ odometerOutKm: 10_000, odometerInKm: 10_250 });
    await stored({
      odometerOutKm: 20_000,
      odometerInKm: 20_400,
      distanceKm: 380,
      distanceSource: "user",
    });
    await stored({ odometerOutKm: 30_000 });
    const res = await request(app).get("/api/v1/rentals/stats").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.km).toEqual({ total: 250 + 380, covered: 2, of: 3 });
  });

  it("reminds about a returned rental with half a pair, not about one with both readings", async () => {
    const half = await stored({ odometerOutKm: 10_000 });
    await stored({ odometerOutKm: 10_000, odometerInKm: 10_250 });
    const res = await request(app).get("/api/v1/rentals/invoice-reminders").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { rentalId: string }) => r.rentalId)).toEqual([half.id]);
  });
});
