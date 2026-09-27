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

  it("hands the trip, its stops and its diary out with times (phase 4)", async () => {
    const stop = await addStop({
      title: "Kyoto",
      lat: 35.0116,
      lon: 135.7681,
      startDate: { local: "2027-04-02T09:00" },
    });
    expect(stop.body.stop.times.start).toEqual({
      utc: "2027-04-02T00:00:00.000Z",
      zone: "Asia/Tokyo",
      offset: "+09:00",
      local: "2027-04-02T09:00:00",
      precision: "minute",
      zoneSource: "stored",
    });
    const entry = await request(app)
      .post(`/api/v1/trips/${tripId}/journal`)
      .set("Cookie", cookie)
      .send({ date: "2027-04-02", body: "Tempel" });
    expect(entry.status).toBe(201);
    expect(entry.body.entry.times.day).toEqual({
      date: "2027-04-02",
      zone: null,
      precision: "day",
    });
    await prisma.trip.update({
      where: { id: tripId },
      data: {
        startDate: new Date("2027-04-01T00:00:00.000Z"),
        startDay: new Date("2027-04-01T00:00:00.000Z"),
        startZone: "Asia/Tokyo",
      },
    });

    const detail = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.trip.times.start).toEqual({
      date: "2027-04-01",
      zone: "Asia/Tokyo",
      precision: "day",
    });
    expect(detail.body.trip.stops[0].times.start.local).toBe("2027-04-02T09:00:00");
    expect(detail.body.trip.journalEntries[0].times.day.date).toBe("2027-04-02");
    const list = await request(app).get("/api/v1/trips").set("Cookie", cookie);
    expect(list.body.trips.find((t: { id: string }) => t.id === tripId).times.start.date).toBe(
      "2027-04-01"
    );
  });

  it("shows a trip's flight in the zone it was STORED with, not today's catalogue", async () => {
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "FRA",
        depLat: 50.030241,
        depLon: 8.561096,
        arrLat: 35.764722,
        arrLon: 140.386389,
        departureTime: new Date("2027-04-01T08:00:00Z"),
        depTimezone: "Europe/Lisbon",
        status: "flown",
      },
    });
    const detail = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    const [flight] = detail.body.trip.flights;
    expect(flight.depTimezone).toBe("Europe/Lisbon");
    expect(flight.times.departure).toMatchObject({
      local: "2027-04-01T09:00:00",
      zoneSource: "stored",
    });
    await prisma.flight.deleteMany({ where: { userId } });
  });
});
