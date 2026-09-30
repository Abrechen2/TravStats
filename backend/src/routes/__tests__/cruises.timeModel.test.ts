import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { mintWriteToken } from "../../shared/time/__tests__/patFixture";

/**
 * ADR 0002 phase 2 — a port call is read on the PORT's clock. The legacy
 * `arrivalTime`/`departureTime` keep the wall clock as fake UTC; the new
 * columns hold the instant, the port's zone, the call's day and precision.
 * Cruise start/end become local days with the departure/arrival port's zone.
 */
const USER = "cruisetimemodel";

describe("Cruises — time model (phase 2)", () => {
  let userId: string;
  let cookie: string;
  let bergen: number;
  let newYork: number;
  let hamburg: number;

  const cleanup = async (): Promise<void> => {
    await prisma.apiToken.deleteMany({ where: { user: { username: USER } } });
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  const portId = async (unlocode: string, name: string, lat: number, lon: number, tz: string) =>
    (
      (await prisma.port.findUnique({ where: { unlocode } })) ??
      (await prisma.port.create({ data: { unlocode, name, lat, lon, timezone: tz } }))
    ).id;

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    bergen = await portId("NOBGO", "Bergen", 60.39, 5.32, "Europe/Oslo");
    newYork = await portId("USNYC", "New York", 40.7128, -74.006, "America/New_York");
    hamburg = await portId("DEHAM", "Hamburg", 53.54, 9.97, "Europe/Berlin");
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const create = (body: Record<string, unknown>, bearer?: string) => {
    const req = request(app).post("/api/v1/cruises");
    if (bearer) req.set("Authorization", bearer);
    else req.set("Cookie", cookie);
    return req.send({ shipNameOverride: "MS Test", startDate: "2027-03-27", ...body });
  };

  it("reads a stop's wall clock on its port's clock and dual-writes both meanings", async () => {
    const res = await create({
      startDate: "2027-07-01",
      endDate: "2027-07-08",
      departurePortId: hamburg,
      arrivalPortId: newYork,
      stops: [
        {
          portId: bergen,
          dayNumber: 3,
          isAtSea: false,
          date: "2027-07-03",
          arrivalTime: { local: "2027-07-03T08:00" },
          departureTime: { local: "2027-07-03T17:30" },
        },
        { portId: null, dayNumber: 4, isAtSea: true, date: "2027-07-04" },
      ],
    });
    expect(res.status).toBe(201);
    const cruise = await prisma.cruise.findUniqueOrThrow({
      where: { id: res.body.data.id },
      include: { stops: { orderBy: { dayNumber: "asc" } } },
    });
    expect(cruise.startDay?.toISOString()).toBe("2027-07-01T00:00:00.000Z");
    expect(cruise.startZone).toBe("Europe/Berlin");
    expect(cruise.endZone).toBe("America/New_York");
    const [call, sea] = cruise.stops;
    expect(call.arrivalTime?.toISOString()).toBe("2027-07-03T08:00:00.000Z");
    expect(call.arrivalUtc?.toISOString()).toBe("2027-07-03T06:00:00.000Z");
    expect(call.departureUtc?.toISOString()).toBe("2027-07-03T15:30:00.000Z");
    expect(call.stopZone).toBe("Europe/Oslo");
    expect(call.stopDate?.toISOString()).toBe("2027-07-03T00:00:00.000Z");
    expect(call.timePrecision).toBe("minute");
    expect(sea.stopZone).toBeNull();
    expect(sea.timePrecision).toBe("day");
  });

  it("refuses a typed arrival the port's clock skipped, naming the stop", async () => {
    const res = await create({
      stops: [
        {
          portId: hamburg,
          dayNumber: 1,
          isAtSea: false,
          arrivalTime: { local: "2027-03-28T02:30" },
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "LOCAL_TIME_NONEXISTENT",
      field: "stops.0.arrivalTime",
    });
    expect(await prisma.cruise.count({ where: { userId } })).toBe(1);
  });

  it("refuses the old bundle's fake-UTC string from a browser", async () => {
    const res = await create({
      stops: [
        { portId: bergen, dayNumber: 1, isAtSea: false, arrivalTime: "2027-07-03T08:00:00.000Z" },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "stops.0.arrivalTime" });
  });

  it("refuses an offset-less string from a browser but takes it from the Companion as the port's clock", async () => {
    const stops = [
      { portId: bergen, dayNumber: 1, isAtSea: false, arrivalTime: "2027-07-03T08:00" },
    ];
    const browser = await create({ stops });
    expect(browser.status).toBe(422);
    expect(browser.body.code).toBe("TIME_SHAPE_REQUIRED");

    const bearer = await mintWriteToken(userId, { deviceId: "phone-cruise" });
    const companion = await create({ stops }, bearer);
    expect(companion.status).toBe(201);
    const stop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruiseId: companion.body.data.id },
    });
    expect(stop.arrivalUtc?.toISOString()).toBe("2027-07-03T06:00:00.000Z");
    expect(stop.arrivalTime?.toISOString()).toBe("2027-07-03T08:00:00.000Z");
  });

  it("keeps an unresolved port's typed time as a wall clock, precision unknown — no UTC guess", async () => {
    const res = await create({
      stops: [
        {
          portId: null,
          isAtSea: false,
          unresolvedPortName: "Nowhere Bay",
          dayNumber: 2,
          arrivalTime: { local: "2027-07-02T09:00" },
        },
      ],
    });
    expect(res.status).toBe(201);
    const stop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruiseId: res.body.data.id },
    });
    expect(stop.arrivalTime?.toISOString()).toBe("2027-07-02T09:00:00.000Z");
    expect(stop.arrivalUtc).toBeNull();
    expect(stop.timePrecision).toBe("unknown");
    expect(stop.stopDate?.toISOString()).toBe("2027-07-02T00:00:00.000Z");
  });

  it("re-derives the day columns and stop times on a PATCH", async () => {
    const created = await create({ startDate: "2027-08-01", departurePortId: hamburg });
    const res = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({
        startDate: "2027-08-02",
        departurePortId: newYork,
        stops: [
          {
            portId: newYork,
            dayNumber: 1,
            isAtSea: false,
            departureTime: { local: "2027-08-02T16:00" },
          },
        ],
      });
    expect(res.status).toBe(200);
    const cruise = await prisma.cruise.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { stops: true },
    });
    expect(cruise.startDay?.toISOString()).toBe("2027-08-02T00:00:00.000Z");
    expect(cruise.startZone).toBe("America/New_York");
    expect(cruise.stops[0].departureUtc?.toISOString()).toBe("2027-08-02T20:00:00.000Z");
  });

  it("hands a cruise out with its days and port calls on the ports' clocks (phase 4)", async () => {
    const res = await create({
      startDate: "2027-08-01",
      endDate: "2027-08-08",
      departurePortId: hamburg,
      arrivalPortId: newYork,
      stops: [
        {
          portId: bergen,
          dayNumber: 3,
          isAtSea: false,
          date: "2027-08-03",
          arrivalTime: { local: "2027-08-03T08:00" },
        },
        { portId: null, dayNumber: 4, isAtSea: true, date: "2027-08-04" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.times).toEqual({
      start: { date: "2027-08-01", zone: "Europe/Berlin", precision: "day" },
      end: { date: "2027-08-08", zone: "America/New_York", precision: "day" },
    });
    const detail = await request(app)
      .get(`/api/v1/cruises/${res.body.data.id}`)
      .set("Cookie", cookie);
    const [call, sea] = detail.body.data.stops;
    expect(call.times).toEqual({
      date: { date: "2027-08-03", zone: "Europe/Oslo", precision: "day" },
      arrival: {
        utc: "2027-08-03T06:00:00.000Z",
        zone: "Europe/Oslo",
        offset: "+02:00",
        local: "2027-08-03T08:00:00",
        precision: "minute",
        zoneSource: "stored",
      },
      departure: null,
    });
    expect(sea.times.date).toEqual({ date: "2027-08-04", zone: null, precision: "day" });
    const list = await request(app).get("/api/v1/cruises").set("Cookie", cookie);
    const row = list.body.data.find((c: { id: string }) => c.id === res.body.data.id);
    expect(row.times.start.date).toBe("2027-08-01");
    expect(row.stops[0].times.arrival.local).toBe("2027-08-03T08:00:00");
  });

  it("never passes a fake-UTC wall clock without a zone off as an instant", async () => {
    const res = await create({
      stops: [{ portId: null, dayNumber: 1, isAtSea: true, date: "2027-03-27" }],
    });
    const stop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruiseId: res.body.data.id },
    });
    // A sea day written before the time model, carrying a clock time.
    await prisma.cruiseStop.update({
      where: { id: stop.id },
      data: { arrivalTime: new Date("2027-03-27T09:00:00.000Z"), arrivalUtc: null },
    });
    const detail = await request(app)
      .get(`/api/v1/cruises/${res.body.data.id}`)
      .set("Cookie", cookie);
    expect(detail.body.data.stops[0].times.arrival).toMatchObject({
      zone: null,
      precision: "unknown",
      local: "2027-03-27T09:00:00",
    });
  });
});
