import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";

const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "kr" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };
const JEONJU = { name: "Jeonju Express Bus Terminal", lat: 35.8402, lon: 127.1289, country: "KR" };

describe("Bus rides API", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/bus").set("Cookie", as).send(body);

  const base = {
    operator: "Kobus",
    lineName: "Premium",
    rideKind: "intercity",
    departureStation: SEOUL,
    arrivalStation: SOKCHO,
    departureLocal: "2026-09-20T09:00",
    arrivalLocal: "2026-09-20T11:20",
    price: 23000,
    currency: "KRW",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["bustest", "busother"] } } });
    const user = await prisma.user.create({
      data: { username: "bustest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "busother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await busCreationLimiter.resetKey(`user:${userId}`);
    await busCreationLimiter.resetKey(`user:${otherUserId}`);
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("creates a ride on the terminals' clocks, enveloped, with its times and a straight-line distance", async () => {
    const res = await create(base);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const ride = res.body.data;
    expect(ride.departureTime).toBe("2026-09-20T00:00:00.000Z");
    expect(ride.arrivalTime).toBe("2026-09-20T02:20:00.000Z");
    expect(ride.depTimezone).toBe("Asia/Seoul");
    expect(ride.depCountry).toBe("KR");
    expect(ride.times.departure.zone).toBe("Asia/Seoul");
    expect(ride.times.departure.local).toBe("2026-09-20T09:00:00");
    expect(ride.distanceSource).toBe("great_circle");
    expect(ride.geometrySource).toBe("straight");
    expect(ride.status).toBe("completed");
    expect(ride.rideKind).toBe("intercity");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses an arrival before the departure with a stable code and field", async () => {
    const res = await create({ ...base, arrivalLocal: "2026-09-20T08:00" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BUS_ARRIVAL_BEFORE_DEPARTURE");
    expect(res.body.field).toBe("arrivalLocal");
  });

  it("refuses a wall clock in a spring-forward gap with 422 LOCAL_TIME_NONEXISTENT", async () => {
    const ZOB = { name: "ZOB Berlin", lat: 52.5069, lon: 13.2778, country: "DE" };
    const res = await create({
      ...base,
      departureStation: ZOB,
      arrivalStation: ZOB,
      departureLocal: "2027-03-28T02:30",
      arrivalLocal: null,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LOCAL_TIME_NONEXISTENT");
    expect(res.body.field).toBe("departureLocal");
  });

  it("names the field of an invalid body", async () => {
    const res = await create({ ...base, departureStation: { name: "No position" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BUS_INVALID_INPUT");
    expect(res.body.field).toBe("departureStation");
  });

  it("refuses a misspelt fold rather than dropping it", async () => {
    const res = await create({ ...base, arrivalFolds: "later" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("arrivalFolds");
  });

  it("stores a day-only ride at the start of its day with precision day", async () => {
    const res = await create({ ...base, departureLocal: "2026-09-21", arrivalLocal: null });
    expect(res.status).toBe(201);
    expect(res.body.data.departureTime).toBe("2026-09-20T15:00:00.000Z");
    expect(res.body.data.times.departure.precision).toBe("day");
    expect(res.body.data.times.arrival).toBeNull();
  });

  it("another user's trip is not a trip (404), and a ride is not readable by strangers", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId: otherUserId,
        name: "Korea",
        startDate: new Date("2026-09-18"),
        endDate: new Date("2026-09-30"),
      },
    });
    const refused = await create({ ...base, tripId: trip.id });
    expect(refused.status).toBe(404);
    const mine = await create(base);
    const stranger = await request(app)
      .get(`/api/v1/bus/${mine.body.data.id}`)
      .set("Cookie", otherCookie);
    expect(stranger.status).toBe(404);
  });

  it("lists one page, newest departure first, with the filtered total and the summary strip", async () => {
    await create(base);
    await create({
      ...base,
      operator: "Kumho",
      departureStation: JEONJU,
      arrivalStation: {
        name: "Busan Central Bus Terminal",
        lat: 35.2156,
        lon: 129.0926,
        country: "KR",
      },
      departureLocal: "2026-09-25T13:00",
      arrivalLocal: "2026-09-25T16:40",
    });
    const res = await request(app).get("/api/v1/bus?limit=1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].operator).toBe("Kumho");
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.summary).toEqual({
      journeys: 2,
      operators: 2,
      withoutOperator: 0,
      stations: 4,
    });
    const filtered = await request(app).get("/api/v1/bus?q=kobus").set("Cookie", cookie);
    expect(filtered.body.meta.total).toBe(1);
  });

  it("filters by the year on the departure terminal's calendar", async () => {
    // 1 Jan 00:30 in Seoul is 31 Dec 15:30 UTC — a 2027 ride, not a 2026 one.
    await create({ ...base, departureLocal: "2027-01-01T00:30", arrivalLocal: "2027-01-01T03:00" });
    const y2026 = await request(app).get("/api/v1/bus?year=2026").set("Cookie", cookie);
    const y2027 = await request(app).get("/api/v1/bus?year=2027").set("Cookie", cookie);
    expect(y2026.body.meta.total).toBe(0);
    expect(y2027.body.meta.total).toBe(1);
  });

  it("updates a field, keeps the ticket's clock when a terminal moves, and re-derives the trip", async () => {
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Korea",
        status: "planned",
        startDate: new Date("2030-01-01"),
        endDate: new Date("2030-01-05"),
      },
    });
    // The ride starts outside the trip, so the trip's status can only change
    // through the PATCH that moves it in.
    const created = await create(base);
    const id = created.body.data.id;
    const before = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(before.status).toBe("planned");
    const patched = await request(app)
      .patch(`/api/v1/bus/${id}`)
      .set("Cookie", cookie)
      .send({ seat: "12A", departureStation: JEONJU, tripId: trip.id });
    expect(patched.status).toBe(200);
    expect(patched.body.data.seat).toBe("12A");
    expect(patched.body.data.depStationName).toBe(JEONJU.name);
    expect(patched.body.data.times.departure.local).toBe("2026-09-20T09:00:00");
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    // The past ride, not the trip's own 2030 plan, now decides its status.
    expect(after.status).toBe("completed");
  });

  it("dual-writes companions and counts them on the companion", async () => {
    const res = await create({ ...base, companions: ["Mina"] });
    expect(res.body.data.companions).toEqual(["Mina"]);
    const links = await prisma.busJourneyCompanion.count({
      where: { busJourneyId: res.body.data.id },
    });
    expect(links).toBe(1);
    const companions = await request(app).get("/api/v1/companions").set("Cookie", cookie);
    expect(
      companions.body.companions.find((c: { name: string }) => c.name === "Mina").usageCount
    ).toBe(1);
  });

  it("leaves the FX snapshot null, never 0, when no rate is available", async () => {
    const res = await create(base);
    expect(res.body.data.currency).toBe("KRW");
    // Without a reachable rate the five columns stay null together; with one they are all filled.
    // What must never happen is a zero standing in for "unknown".
    expect(res.body.data.priceBase).not.toBe(0);
    expect(res.body.data.fxRate).not.toBe(0);
    expect(res.body.data.priceBase === null).toBe(res.body.data.fxRate === null);
  });

  it("answers 404 to another user's PATCH and DELETE and changes nothing", async () => {
    const mine = await create(base);
    const id = mine.body.data.id;
    const patched = await request(app)
      .patch(`/api/v1/bus/${id}`)
      .set("Cookie", otherCookie)
      .send({ seat: "99Z" });
    expect(patched.status).toBe(404);
    const deleted = await request(app).delete(`/api/v1/bus/${id}`).set("Cookie", otherCookie);
    expect(deleted.status).toBe(404);
    const row = await prisma.busJourney.findUniqueOrThrow({ where: { id } });
    expect(row.seat).toBeNull();
    expect(row.userId).toBe(userId);
  });

  it("answers 404 to a create that names another user's booking", async () => {
    const booking = await prisma.booking.create({ data: { userId: otherUserId } });
    try {
      const res = await create({ ...base, bookingId: booking.id });
      expect(res.status).toBe(404);
      expect(await prisma.busJourney.count({ where: { userId } })).toBe(0);
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  it("deletes, then 404s", async () => {
    const res = await create(base);
    const del = await request(app).delete(`/api/v1/bus/${res.body.data.id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/v1/bus/${res.body.data.id}`).set("Cookie", cookie);
    expect(gone.status).toBe(404);
  });

  it("limits creation per user on its own bucket", async () => {
    const first = await create(base);
    expect(Number(first.headers["ratelimit-limit"])).toBe(300);
    const other = await create(base, otherCookie);
    expect(Number(other.headers["ratelimit-remaining"])).toBe(299);
  });
});
