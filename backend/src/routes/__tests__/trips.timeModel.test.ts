import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * ADR 0002 phase 2 for trips: a stop's times are read on the stop's clock
 * (its coordinates, else the entry it wraps) and dual-written; trip start/end
 * and journal dates are calendar days with DATE copies.
 */
const USER = "triptimemodel";

describe("Trips — time model (phase 2)", () => {
  let userId: string;
  let cookie: string;
  let tripId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.trip.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    tripId = (await prisma.trip.create({ data: { userId, name: "Japan" } })).id;
  });

  const addStop = (body: Record<string, unknown>) =>
    request(app).post(`/api/v1/trips/${tripId}/stops`).set("Cookie", cookie).send(body);

  it("reads a stop's wall clock at its coordinates and dual-writes it", async () => {
    const res = await addStop({
      title: "Kyoto",
      lat: 35.0116,
      lon: 135.7681,
      startDate: { local: "2027-04-02T09:00" },
      endDate: "2027-04-04",
    });
    expect(res.status).toBe(201);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: res.body.stop.id } });
    expect(stop.startDate?.toISOString()).toBe("2027-04-02T09:00:00.000Z");
    expect(stop.startUtc?.toISOString()).toBe("2027-04-02T00:00:00.000Z");
    expect(stop.endUtc?.toISOString()).toBe("2027-04-03T15:00:00.000Z");
    expect(stop.stopZone).toBe("Asia/Tokyo");
    expect(stop.precision).toBe("minute");
  });

  it("takes the zone from the entry a stop wraps when it has no coordinates", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Sagrada Família", lat: 41.4036, lon: 2.1744 },
    });
    const res = await addStop({
      title: "Sagrada",
      domain: "poi",
      sourceId: place.id,
      startDate: { local: "2027-04-10T10:00" },
    });
    expect(res.status).toBe(201);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: res.body.stop.id } });
    expect(stop.stopZone).toBe("Europe/Madrid");
    expect(stop.startUtc?.toISOString()).toBe("2027-04-10T08:00:00.000Z");
  });

  it("keeps a placeless stop's time as a wall clock, precision unknown — never read as UTC", async () => {
    const res = await addStop({ title: "Somewhere", startDate: { local: "2027-04-10T10:00" } });
    expect(res.status).toBe(201);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: res.body.stop.id } });
    expect(stop.startDate?.toISOString()).toBe("2027-04-10T10:00:00.000Z");
    expect(stop.startUtc).toBeNull();
    expect(stop.precision).toBe("unknown");
  });

  it("refuses a browser's fake-UTC string and a skipped hour, naming the field", async () => {
    const stale = await addStop({
      title: "Berlin",
      lat: 52.52,
      lon: 13.4,
      startDate: "2027-04-10T10:00:00.000Z",
    });
    expect(stale.status).toBe(422);
    expect(stale.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "startDate" });
    const gap = await addStop({
      title: "Berlin",
      lat: 52.52,
      lon: 13.4,
      startDate: { local: "2027-03-28T02:30" },
    });
    expect(gap.status).toBe(422);
    expect(gap.body).toMatchObject({ code: "LOCAL_TIME_NONEXISTENT", field: "startDate" });
  });

  it("re-reads stored times in the new zone when a PATCH moves the stop", async () => {
    const created = await addStop({ title: "X", startDate: { local: "2027-04-10T10:00" } });
    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}/stops/${created.body.stop.id}`)
      .set("Cookie", cookie)
      .send({ lat: 52.52, lon: 13.4 });
    expect(res.status).toBe(200);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: created.body.stop.id } });
    expect(stop.stopZone).toBe("Europe/Berlin");
    expect(stop.startUtc?.toISOString()).toBe("2027-04-10T08:00:00.000Z");
  });

  it("writes trip days and journal days as DATE copies", async () => {
    const patched = await request(app)
      .patch(`/api/v1/trips/${tripId}`)
      .set("Cookie", cookie)
      .send({ startDate: "2027-04-01", endDate: "2027-04-12T00:00:00+09:00" });
    expect(patched.status).toBe(200);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.startDay?.toISOString()).toBe("2027-04-01T00:00:00.000Z");
    expect(trip.endDay?.toISOString()).toBe("2027-04-12T00:00:00.000Z");
    expect(trip.startZone).toBeNull();

    const entry = await request(app)
      .post(`/api/v1/trips/${tripId}/journal`)
      .set("Cookie", cookie)
      .send({ date: "2027-04-03", body: "Tempel" });
    expect(entry.status).toBe(201);
    const row = await prisma.tripJournalEntry.findUniqueOrThrow({
      where: { id: entry.body.entry.id },
    });
    expect(row.day?.toISOString()).toBe("2027-04-03T00:00:00.000Z");
  });

  it("refuses an offset-less trip day with 422 TIME_SHAPE_REQUIRED", async () => {
    const res = await request(app)
      .patch(`/api/v1/trips/${tripId}`)
      .set("Cookie", cookie)
      .send({ startDate: "2027-04-01T00:30" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "startDate" });
  });
});
