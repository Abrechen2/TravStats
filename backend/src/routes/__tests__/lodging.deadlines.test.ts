import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#285 — a stay's booking deadlines. Free cancellation is an instant
 * on the HOTEL's clock (a bare `{local}` leans on the hotel's zone), or only
 * a day — then no hour is invented. The payment due day carries no zone.
 */
const USER = "staydeadlines";

describe("Lodging stays — booking deadlines (forgejo#285)", () => {
  let userId: string;
  let cookie: string;
  let berlinId: string;
  let unplacedId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.lodgingStay.deleteMany({ where: { user: { username: USER } } });
    await prisma.lodging.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    berlinId = (
      await prisma.lodging.create({ data: { userId, name: "Adlon", lat: 52.5163, lon: 13.3805 } })
    ).id;
    unplacedId = (await prisma.lodging.create({ data: { userId, name: "Somewhere" } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const post = (lodgingId: string, body: unknown) =>
    request(app).post(`/api/v1/lodging/${lodgingId}/stays`).set("Cookie", cookie).send(body);
  const patch = (lodgingId: string, stayId: string, body: unknown) =>
    request(app)
      .patch(`/api/v1/lodging/${lodgingId}/stays/${stayId}`)
      .set("Cookie", cookie)
      .send(body);
  const stay = { checkIn: "2027-05-02", checkOut: "2027-05-04", status: "scheduled" };

  it("reads a bare {local} on the hotel's clock and hands both deadlines back as times", async () => {
    const res = await post(berlinId, {
      ...stay,
      freeCancellationUntil: { local: "2027-05-01T18:00" },
      paymentDueOn: "2027-04-15",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times.freeCancellationUntil).toMatchObject({
      utc: "2027-05-01T16:00:00.000Z",
      zone: "Europe/Berlin",
      local: "2027-05-01T18:00:00",
      precision: "minute",
    });
    expect(res.body.data.times.freeCancellationOn).toBeNull();
    expect(res.body.data.times.paymentDue).toEqual({
      date: "2027-04-15",
      zone: null,
      precision: "day",
    });
    expect(res.body.data.paymentDueOn).toBe("2027-04-15");
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.freeCancellationUntil?.toISOString()).toBe("2027-05-01T16:00:00.000Z");
    expect(row.freeCancellationZone).toBe("Europe/Berlin");
  });

  it("keeps a deadline known only to the day as that day, on the hotel's zone", async () => {
    const res = await post(berlinId, { ...stay, freeCancellationUntil: "2027-04-30" });
    expect(res.status).toBe(201);
    expect(res.body.data.times.freeCancellationUntil).toBeNull();
    expect(res.body.data.times.freeCancellationOn).toEqual({
      date: "2027-04-30",
      zone: "Europe/Berlin",
      precision: "day",
    });
    expect(res.body.data.freeCancellationOn).toBe("2027-04-30");
    expect(res.body.data.freeCancellationUntil).toBeNull();
  });

  it("leaves the deadlines alone when a PATCH does not send them, and clears them on null", async () => {
    const created = await post(berlinId, {
      ...stay,
      freeCancellationUntil: { local: "2027-05-01T18:00", zone: "Asia/Tokyo" },
      paymentDueOn: "2027-04-15",
    });
    const id = created.body.data.id;
    expect(created.body.data.times.freeCancellationUntil.zone).toBe("Asia/Tokyo");

    const untouched = await patch(berlinId, id, { notes: "late arrival" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.data.times.freeCancellationUntil.utc).toBe("2027-05-01T09:00:00.000Z");
    expect(untouched.body.data.times.paymentDue.date).toBe("2027-04-15");

    const cleared = await patch(berlinId, id, { freeCancellationUntil: null, paymentDueOn: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.times).toMatchObject({
      freeCancellationUntil: null,
      freeCancellationOn: null,
      paymentDue: null,
    });
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id } });
    expect(row.freeCancellationZone).toBeNull();
  });

  it("switches an instant deadline to a day one without leaving the instant behind", async () => {
    const created = await post(berlinId, {
      ...stay,
      freeCancellationUntil: { local: "2027-05-01T18:00" },
    });
    const res = await patch(berlinId, created.body.data.id, {
      freeCancellationUntil: "2027-04-29",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.times.freeCancellationUntil).toBeNull();
    expect(res.body.data.times.freeCancellationOn.date).toBe("2027-04-29");
  });

  it("refuses an offset-less datetime with 422 TIME_SHAPE_REQUIRED", async () => {
    const res = await post(berlinId, { ...stay, freeCancellationUntil: "2027-05-01T18:00" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "freeCancellationUntil" });
  });

  it("refuses a bare {local} at a hotel without a zone with 422 TZ_UNRESOLVED", async () => {
    const res = await post(unplacedId, {
      ...stay,
      freeCancellationUntil: { local: "2027-05-01T18:00" },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TZ_UNRESOLVED", field: "freeCancellationUntil" });
  });

  it("serves the deadlines on the lodging's own read", async () => {
    await post(berlinId, { ...stay, paymentDueOn: "2027-03-01" });
    const res = await request(app).get(`/api/v1/lodging/${berlinId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const dues = res.body.data.stays.map(
      (s: { times: { paymentDue: { date: string } | null } }) => s.times.paymentDue?.date ?? null
    );
    expect(dues).toContain("2027-03-01");
  });
});
