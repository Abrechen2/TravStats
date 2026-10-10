import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * forgejo#285 — a rental's booking deadlines. A bare `{local}` (or a bare
 * day) is read on the PICKUP station's clock; the payment due day has no
 * zone. Every value is invented.
 */
describe("Rental — booking deadlines (forgejo#285)", () => {
  let cookie: string;
  let userId: string;

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/rentals").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/rentals/${id}`).set("Cookie", cookie).send(body);

  const base = {
    provider: "Testcar",
    pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
    pickupLocal: "2027-07-10T10:00",
    returnLocal: "2027-07-12T10:00",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rentaldeadlines" } });
    const user = await prisma.user.create({
      data: { username: "rentaldeadlines", passwordHash: await hashPassword("password123") },
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

  it("reads a bare {local} at the pickup station and the payment day without a zone", async () => {
    const res = await create({
      ...base,
      freeCancellationUntil: { local: "2027-07-08T12:00" },
      paymentDueOn: "2027-07-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times.freeCancellationUntil).toMatchObject({
      utc: "2027-07-08T10:00:00.000Z",
      zone: "Europe/Berlin",
      local: "2027-07-08T12:00:00",
    });
    expect(res.body.data.times.paymentDue).toEqual({
      date: "2027-07-01",
      zone: null,
      precision: "day",
    });
    expect(res.body.data.paymentDueOn).toBe("2027-07-01");
  });

  it("takes the zone of a named place when the confirmation states another clock", async () => {
    const res = await create({
      ...base,
      freeCancellationUntil: {
        local: "2027-07-08T09:00",
        placeRef: { kind: "airport", id: "JFK" },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times.freeCancellationUntil).toMatchObject({
      utc: "2027-07-08T13:00:00.000Z",
      zone: "America/New_York",
    });
  });

  it("keeps a day-only deadline as a day at the pickup station", async () => {
    const res = await create({ ...base, freeCancellationUntil: "2027-07-08" });
    expect(res.status).toBe(201);
    expect(res.body.data.times.freeCancellationUntil).toBeNull();
    expect(res.body.data.times.freeCancellationOn).toEqual({
      date: "2027-07-08",
      zone: "Europe/Berlin",
      precision: "day",
    });
    expect(res.body.data.freeCancellationOn).toBe("2027-07-08");
  });

  it("leaves deadlines alone on an unrelated PATCH, clears them on null", async () => {
    const id = (
      await create({
        ...base,
        freeCancellationUntil: { local: "2027-07-08T12:00" },
        paymentDueOn: "2027-07-01",
      })
    ).body.data.id;
    const untouched = await patch(id, { notes: "child seat" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.data.times.freeCancellationUntil.utc).toBe("2027-07-08T10:00:00.000Z");
    expect(untouched.body.data.times.paymentDue.date).toBe("2027-07-01");

    const cleared = await patch(id, { freeCancellationUntil: null, paymentDueOn: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.times).toMatchObject({
      freeCancellationUntil: null,
      freeCancellationOn: null,
      paymentDue: null,
    });
  });

  it("does not record a deadline re-sent as stored as a hand edit", async () => {
    const id = (await create({ ...base, paymentDueOn: "2027-07-01" })).body.data.id;
    await prisma.rentalBooking.update({ where: { id }, data: { userEditedFields: [] } });
    const res = await patch(id, { paymentDueOn: "2027-07-01" });
    expect(res.status).toBe(200);
    expect(res.body.data.userEditedFields).not.toContain("paymentDueOn");
  });

  it("refuses an offset-less datetime with 422 TIME_SHAPE_REQUIRED", async () => {
    const res = await create({ ...base, freeCancellationUntil: "2027-07-08T12:00" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "freeCancellationUntil" });
  });
});
