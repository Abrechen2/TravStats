import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { setClockForTests } from "../../shared/time/clock";

/**
 * ADR 0002 phase 2 — a stay is written with its days as DATEs, the check-in
 * and check-out instants read on the HOTEL's clock, and the hotel's zone;
 * the legacy UTC-midnight anchors keep their meaning. Its status answers
 * "today" in the user's PROFILE zone (D4), not in Greenwich.
 */
const USER = "staytimemodel";

describe("Lodging stays — time model (phase 2)", () => {
  let userId: string;
  let cookie: string;
  let tokyoId: string;
  let berlinId: string;
  let unplacedId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.lodgingStay.deleteMany({ where: { user: { username: USER } } });
    await prisma.lodging.deleteMany({ where: { user: { username: USER } } });
    await prisma.userSettings.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const mk = (name: string, lat: number | null, lon: number | null) =>
      prisma.lodging.create({ data: { userId, name, lat, lon } });
    tokyoId = (await mk("Park Hyatt Tokyo", 35.6856, 139.6907)).id;
    berlinId = (await mk("Adlon", 52.5163, 13.3805)).id;
    unplacedId = (await mk("Somewhere", null, null)).id;
  });

  afterAll(async () => {
    setClockForTests(null);
    await cleanup();
    await prisma.$disconnect();
  });

  const post = (lodgingId: string, body: unknown) =>
    request(app).post(`/api/v1/lodging/${lodgingId}/stays`).set("Cookie", cookie).send(body);

  it("stores the days, the hotel-clock instants and the hotel's zone", async () => {
    const res = await post(tokyoId, {
      checkIn: "2027-05-02",
      checkOut: "2027-05-04",
      checkInTime: "15:00",
      checkOutTime: "11:00",
    });
    expect(res.status).toBe(201);
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.checkIn?.toISOString()).toBe("2027-05-02T00:00:00.000Z");
    expect(row.checkInDate?.toISOString()).toBe("2027-05-02T00:00:00.000Z");
    expect(row.checkOutDate?.toISOString()).toBe("2027-05-04T00:00:00.000Z");
    expect(row.checkInAt?.toISOString()).toBe("2027-05-02T06:00:00.000Z");
    expect(row.checkOutAt?.toISOString()).toBe("2027-05-04T02:00:00.000Z");
    expect(row.stayZone).toBe("Asia/Tokyo");
  });

  it("reads an offset-bearing day as the day it writes (older clients)", async () => {
    const res = await post(tokyoId, { checkIn: "2027-06-10T00:00:00+09:00" });
    expect(res.status).toBe(201);
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.checkInDate?.toISOString()).toBe("2027-06-10T00:00:00.000Z");
  });

  it("refuses an offset-less datetime with 422 TIME_SHAPE_REQUIRED on checkIn", async () => {
    const res = await post(tokyoId, { checkIn: "2027-05-02T15:00" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "checkIn" });
  });

  it("refuses a check-in time the hotel's clock skipped", async () => {
    const res = await post(berlinId, { checkIn: "2027-03-28", checkInTime: "02:30" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "LOCAL_TIME_NONEXISTENT", field: "checkInTime" });
  });

  it("keeps the days and leaves the instants null for a hotel with no position — never UTC", async () => {
    const res = await post(unplacedId, { checkIn: "2027-05-02", checkInTime: "15:00" });
    expect(res.status).toBe(201);
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.checkInDate?.toISOString()).toBe("2027-05-02T00:00:00.000Z");
    expect(row.checkInAt).toBeNull();
    expect(row.stayZone).toBeNull();
  });

  it("re-derives the instants from the MERGED stay on a PATCH of one field", async () => {
    const created = await post(tokyoId, {
      checkIn: "2027-07-01",
      checkOut: "2027-07-03",
      checkInTime: "15:00",
    });
    const res = await request(app)
      .patch(`/api/v1/lodging/${tokyoId}/stays/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ checkIn: "2027-07-02" });
    expect(res.status).toBe(200);
    const row = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row.checkInDate?.toISOString()).toBe("2027-07-02T00:00:00.000Z");
    expect(row.checkInAt?.toISOString()).toBe("2027-07-02T06:00:00.000Z");
  });

  it("answers the status in the user's profile zone, not in UTC", async () => {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: { display: { timezone: "Pacific/Kiritimati" } } },
      update: { data: { display: { timezone: "Pacific/Kiritimati" } } },
    });
    // 2027-01-01T11:00Z is already 01:00 on 2 January in Kiritimati (+14):
    // check-out day has begun there, while in UTC it is still 1 January.
    setClockForTests("2027-01-01T11:00:00Z");
    try {
      const res = await post(berlinId, { checkIn: "2026-12-28", checkOut: "2027-01-02" });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("completed");
    } finally {
      setClockForTests(null);
    }
  });

  it("hands the stay out with its days as YYYY-MM-DD and its hours on the hotel's clock (phase 4)", async () => {
    const res = await post(tokyoId, {
      checkIn: "2027-08-02",
      checkOut: "2027-08-04",
      checkInTime: "15:00",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times).toEqual({
      checkIn: { date: "2027-08-02", zone: "Asia/Tokyo", precision: "day" },
      checkOut: { date: "2027-08-04", zone: "Asia/Tokyo", precision: "day" },
      checkInAt: {
        utc: "2027-08-02T06:00:00.000Z",
        zone: "Asia/Tokyo",
        offset: "+09:00",
        local: "2027-08-02T15:00:00",
        precision: "minute",
        zoneSource: "stored",
      },
      checkOutAt: null,
    });
    const detail = await request(app).get(`/api/v1/lodging/${tokyoId}`).set("Cookie", cookie);
    const stay = detail.body.data.stays.find((s: { id: string }) => s.id === res.body.data.id);
    expect(stay.times.checkOut.date).toBe("2027-08-04");
    const list = await request(app).get("/api/v1/lodging").set("Cookie", cookie);
    const row = list.body.data.find((l: { id: string }) => l.id === tokyoId);
    expect(row.stays.every((s: { times?: unknown }) => s.times !== undefined)).toBe(true);
  });

  it("says a vague stay's precision and reads a not-yet-migrated anchor by the backfill's rule", async () => {
    const vague = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: berlinId,
        checkIn: new Date("2011-07-01T00:00:00.000Z"),
        datePrecision: "MONTH",
      },
    });
    // A day written by a host at UTC+2 before the time model: 22:00 the evening before.
    const legacy = await prisma.lodgingStay.create({
      data: { userId, lodgingId: berlinId, checkIn: new Date("2019-05-01T22:00:00.000Z") },
    });
    const detail = await request(app).get(`/api/v1/lodging/${berlinId}`).set("Cookie", cookie);
    const byId = (id: string) => detail.body.data.stays.find((s: { id: string }) => s.id === id);
    expect(byId(vague.id).times.checkIn).toEqual({
      date: "2011-07-01",
      zone: null,
      precision: "month",
    });
    expect(byId(legacy.id).times.checkIn.date).toBe("2019-05-02");
  });
});
