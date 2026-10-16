jest.mock("../../services/ferry/ticketPreview", () => ({ previewFerryText: jest.fn() }));
jest.mock("../../services/ferry/aisStream", () => ({
  aisConfigured: () => false,
  lookupVessel: jest.fn(),
}));
import { previewFerryText } from "../../services/ferry/ticketPreview";
import { lookupVessel } from "../../services/ferry/aisStream";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";

const SEOUL = { name: "Seoul Express Ferry Terminal", lat: 37.5048, lon: 127.0046, country: "kr" };
const SOKCHO = {
  name: "Sokcho Express Ferry Terminal",
  lat: 38.1911,
  lon: 128.5918,
  country: "KR",
};
const JEONJU = {
  name: "Jeonju Express Ferry Terminal",
  lat: 35.8402,
  lon: 127.1289,
  country: "KR",
};

describe("Ferry rides API", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/ferry").set("Cookie", as).send(body);

  const base = {
    operator: "Koferry",
    vesselName: "Premium",
    vehicleType: "motorhome",
    departureStation: SEOUL,
    arrivalStation: SOKCHO,
    departureLocal: "2026-09-20T09:00",
    arrivalLocal: "2026-09-20T11:20",
    price: 23000,
    currency: "KRW",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["ferrytest", "ferryother"] } } });
    const user = await prisma.user.create({
      data: { username: "ferrytest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "ferryother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    await prisma.ferryJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await ferryCreationLimiter.resetKey(`user:${userId}`);
    await ferryCreationLimiter.resetKey(`user:${otherUserId}`);
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
    expect(ride.vehicleType).toBe("motorhome");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses an arrival before the departure with a stable code and field", async () => {
    const res = await create({ ...base, arrivalLocal: "2026-09-20T08:00" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FERRY_ARRIVAL_BEFORE_DEPARTURE");
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
    expect(res.body.code).toBe("FERRY_INVALID_INPUT");
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
      .get(`/api/v1/ferry/${mine.body.data.id}`)
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
        name: "Ferryan Central Ferry Terminal",
        lat: 35.2156,
        lon: 129.0926,
        country: "KR",
      },
      departureLocal: "2026-09-25T13:00",
      arrivalLocal: "2026-09-25T16:40",
    });
    const res = await request(app).get("/api/v1/ferry?limit=1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].operator).toBe("Kumho");
    // The pre-link routing snapshot is bookkeeping for unlinking, not part of a crossing.
    expect(res.body.data[0]).not.toHaveProperty("roadtripLegBefore");
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.summary).toEqual({
      journeys: 2,
      operators: 2,
      withoutOperator: 0,
      stations: 4,
    });
    const filtered = await request(app).get("/api/v1/ferry?q=koferry").set("Cookie", cookie);
    expect(filtered.body.meta.total).toBe(1);
  });

  it("filters by the year on the departure terminal's calendar", async () => {
    // 1 Jan 00:30 in Seoul is 31 Dec 15:30 UTC — a 2027 ride, not a 2026 one.
    await create({ ...base, departureLocal: "2027-01-01T00:30", arrivalLocal: "2027-01-01T03:00" });
    const y2026 = await request(app).get("/api/v1/ferry?year=2026").set("Cookie", cookie);
    const y2027 = await request(app).get("/api/v1/ferry?year=2027").set("Cookie", cookie);
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
      .patch(`/api/v1/ferry/${id}`)
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
    const links = await prisma.ferryJourneyCompanion.count({
      where: { ferryJourneyId: res.body.data.id },
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
      .patch(`/api/v1/ferry/${id}`)
      .set("Cookie", otherCookie)
      .send({ seat: "99Z" });
    expect(patched.status).toBe(404);
    const deleted = await request(app).delete(`/api/v1/ferry/${id}`).set("Cookie", otherCookie);
    expect(deleted.status).toBe(404);
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
    expect(row.seat).toBeNull();
    expect(row.userId).toBe(userId);
  });

  it("answers 404 to a create that names another user's booking", async () => {
    const booking = await prisma.booking.create({ data: { userId: otherUserId } });
    try {
      const res = await create({ ...base, bookingId: booking.id });
      expect(res.status).toBe(404);
      expect(await prisma.ferryJourney.count({ where: { userId } })).toBe(0);
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  it("deletes, then 404s", async () => {
    const res = await create(base);
    const del = await request(app)
      .delete(`/api/v1/ferry/${res.body.data.id}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/v1/ferry/${res.body.data.id}`).set("Cookie", cookie);
    expect(gone.status).toBe(404);
  });

  it("limits creation per user on its own bucket", async () => {
    const first = await create(base);
    expect(Number(first.headers["ratelimit-limit"])).toBe(300);
    const other = await create(base, otherCookie);
    expect(Number(other.headers["ratelimit-remaining"])).toBe(299);
  });
  it("keeps vehicle dimensions, passenger count, cabin and both references", async () => {
    const res = await create({
      ...base,
      vehicleLengthM: 7.4,
      vehicleWidthM: 2.3,
      vehicleHeightM: 3.1,
      passengerCount: 2,
      cabinType: "Outside cabin",
      seat: "12A",
      bookingReference: "BOOK-42",
      ticketReference: "TICKET-7",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      vehicleType: "motorhome",
      vehicleLengthM: 7.4,
      vehicleWidthM: 2.3,
      vehicleHeightM: 3.1,
      passengerCount: 2,
      cabinType: "Outside cabin",
      seat: "12A",
      bookingReference: "BOOK-42",
      ticketReference: "TICKET-7",
    });
    expect((await create({ ...base, vehicleHeightM: -1 })).status).toBe(400);
    expect((await create({ ...base, passengerCount: 1.5 })).status).toBe(400);
  });

  it("links a roadtrip leg as ferry, excluding sea kilometres from driving", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Adriatic trip" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Coast", kind: "roadtrip", mode: "road" },
    });
    const from = await prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title: "Port A", lat: 37.5, lon: 127 },
    });
    const to = await prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title: "Port B", lat: 38.1, lon: 128 },
    });
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        mode: "road",
        source: "routed",
        distanceKm: 500,
        drivingMinutes: 300,
      },
    });
    const ride = await create({ ...base, tripId: trip.id });
    const url = `/api/v1/ferry/${ride.body.data.id}/roadtrip-leg`;
    expect(
      (await request(app).put(url).set("Cookie", otherCookie).send({ legId: leg.id })).status
    ).toBe(404);
    expect((await request(app).put(url).set("Cookie", cookie).send({ legId: leg.id })).status).toBe(
      200
    );
    const stored = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(stored).toMatchObject({
      mode: "ferry",
      source: "straight",
      drivingMinutes: null,
      waypoints: null,
    });
    const { drivenKm } = await import("../../services/tour/tourDistance");
    expect(drivenKm([stored, { mode: "road", distanceKm: 100 }])).toBe(100);
    expect(
      (
        await request(app)
          .patch(`/api/v1/ferry/${ride.body.data.id}`)
          .set("Cookie", cookie)
          .send({ tripId: null })
      ).status
    ).toBe(409);
    expect((await request(app).put(url).set("Cookie", cookie).send({ legId: null })).status).toBe(
      200
    );
  });

  it("gives a leg back exactly as it was when its crossing is unlinked or moved to another leg", async () => {
    // Linking wiped the leg's road routing (mode, waypoints, driving time,
    // distance) and nothing ever restored it: unlinking left a straight ferry
    // leg where a routed road had been.
    const trip = await prisma.trip.create({ data: { userId, name: "Relink trip" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Coast", kind: "roadtrip", mode: "road" },
    });
    const stops = await Promise.all(
      ["A", "B", "C"].map((title, i) =>
        prisma.tripStop.create({
          data: { tripId: trip.id, routeId: route.id, title, lat: 37 + i, lon: 127 + i },
        })
      )
    );
    const routed = {
      mode: "road",
      source: "routed",
      confidence: "high",
      distanceKm: 512.5,
      drivingMinutes: 301,
      waypoints: [
        [127, 37],
        [127.5, 37.6],
        [128, 38],
      ],
    };
    const first = await prisma.tripRouteLeg.create({
      data: { routeId: route.id, fromStopId: stops[0].id, toStopId: stops[1].id, ...routed },
    });
    const second = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: stops[1].id,
        toStopId: stops[2].id,
        ...routed,
        mode: "bike",
        distanceKm: 99,
      },
    });
    const pick = (leg: Record<string, unknown>) => ({
      mode: leg.mode,
      source: leg.source,
      confidence: leg.confidence,
      distanceKm: leg.distanceKm,
      drivingMinutes: leg.drivingMinutes,
      waypoints: leg.waypoints,
    });
    const ride = await create({ ...base, tripId: trip.id });
    const url = `/api/v1/ferry/${ride.body.data.id}/roadtrip-leg`;
    const link = (legId: string | null) =>
      request(app).put(url).set("Cookie", cookie).send({ legId });
    const read = async (id: string) =>
      pick(await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id } }));

    expect((await link(first.id)).status).toBe(200);
    expect((await read(first.id)).mode).toBe("ferry");
    // Linking the same leg again keeps the original, not the ferry state.
    expect((await link(first.id)).status).toBe(200);
    // Moving the crossing restores the first leg and takes the second.
    expect((await link(second.id)).status).toBe(200);
    expect(await read(first.id)).toEqual(pick(routed));
    expect((await read(second.id)).mode).toBe("ferry");
    expect((await link(null)).status).toBe(200);
    expect(await read(second.id)).toEqual(pick({ ...routed, mode: "bike", distanceKm: 99 }));
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("lists the newest roadtrip legs first and says when the list was cut", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Long trip" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Long", kind: "roadtrip", mode: "road" },
    });
    const stops = await prisma.tripStop.createManyAndReturn({
      data: Array.from({ length: 24 }, (_, i) => ({
        tripId: trip.id,
        routeId: route.id,
        title: `S${i}`,
        lat: 40 + i / 10,
        lon: 10,
      })),
    });
    const pairs = stops.flatMap((a) => stops.filter((b) => b !== a).map((b) => [a, b] as const));
    const computedAt = new Date("2026-01-01T00:00:00Z");
    await prisma.tripRouteLeg.createMany({
      data: pairs.slice(0, 501).map(([a, b]) => ({
        routeId: route.id,
        fromStopId: a.id,
        toStopId: b.id,
        mode: "road",
        source: "straight",
        distanceKm: 1,
        computedAt,
      })),
    });
    const res = await request(app).get("/api/v1/ferry/roadtrip-legs").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(500);
    expect(res.body.meta).toEqual({ truncated: true });
    // Same computedAt for every row: the id tie-breaker makes the cut stable.
    const again = await request(app).get("/api/v1/ferry/roadtrip-legs").set("Cookie", cookie);
    expect(again.body.data.map((l: { id: string }) => l.id)).toEqual(
      res.body.data.map((l: { id: string }) => l.id)
    );
    await prisma.trip.delete({ where: { id: trip.id } });
  });
  it("files a retained ticket, refuses a foreign document and cascades ownership on delete", async () => {
    const ticket = await prisma.document.create({
      data: {
        userId,
        storedName: "ferry-fixture.pdf",
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: "ferry-fixture",
        format: "pdf",
        kind: "ticket",
      },
    });
    const foreign = await prisma.document.create({
      data: {
        userId: otherUserId,
        storedName: "foreign-ferry.pdf",
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: "foreign-ferry",
        format: "pdf",
      },
    });
    const refused = await create({ ...base, documentIds: [foreign.id] });
    expect(refused.status).toBe(404);
    const created = await create({ ...base, documentIds: [ticket.id] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const docs = await request(app).get(`/api/v1/ferry/${id}/documents`).set("Cookie", cookie);
    expect(docs.status).toBe(200);
    expect(docs.body.data.map((d: { id: string }) => d.id)).toEqual([ticket.id]);
    expect(
      (await request(app).get(`/api/v1/ferry/${id}/documents`).set("Cookie", otherCookie)).status
    ).toBe(404);
    await request(app).delete(`/api/v1/ferry/${id}`).set("Cookie", cookie);
    expect(await prisma.document.findUnique({ where: { id: ticket.id } })).toBeNull();
  });
  it("previews text without creating a crossing", async () => {
    jest.mocked(previewFerryText).mockResolvedValue({
      crossings: [],
      parser: "labels",
      reason: "nothingFound",
      provider: null,
    });
    const before = await prisma.ferryJourney.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/ferry/ticket-preview")
      .set("Cookie", cookie)
      .send({ text: "Ferry booking from Bari to Durres with a cabin for two people" });
    expect(res.status).toBe(200);
    expect(previewFerryText).toHaveBeenCalledWith(expect.any(String), userId);
    expect(await prisma.ferryJourney.count({ where: { userId } })).toBe(before);
  });
  it("requires authentication and rejects another user's document before reading it", async () => {
    expect(
      (await request(app).post("/api/v1/ferry/ticket-preview").send({ text: "ticket" })).status
    ).toBe(401);
    const doc = await prisma.document.create({
      data: {
        userId: otherUserId,
        storedName: "ferry-test-no-bytes.pdf",
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: "preview-test",
        format: "pdf",
      },
    });
    const res = await request(app)
      .post("/api/v1/ferry/ticket-preview")
      .set("Cookie", cookie)
      .send({ documentId: doc.id });
    expect(res.status).toBe(404);
  });
  it("tells an unreadable text layer from a parsing failure", async () => {
    const res = await request(app)
      .post("/api/v1/ferry/ticket-preview")
      .set("Cookie", cookie)
      .send({ text: "1" });
    expect(res.body.data.reason).toBe("noText");
  });
  it("checks ownership before any live provider request and exposes no credential", async () => {
    jest.mocked(lookupVessel).mockClear();
    const mine = await create(base);
    expect(
      (
        await request(app)
          .get(`/api/v1/ferry/${mine.body.data.id}/live-position?mmsi=211123456`)
          .set("Cookie", otherCookie)
      ).status
    ).toBe(404);
    expect(lookupVessel).not.toHaveBeenCalled();
    jest.mocked(lookupVessel).mockResolvedValue({ status: "notConfigured", position: null });
    const res = await request(app)
      .get(`/api/v1/ferry/${mine.body.data.id}/live-position?mmsi=211123456`)
      .set("Cookie", cookie);
    expect(res.body.data).toEqual({ status: "notConfigured", position: null });
    expect(
      (await request(app).get("/api/v1/ferry/live-availability").set("Cookie", cookie)).body.data
    ).toEqual({ configured: false, provider: "AISStream" });
  });
  it("binds the vessel to the crossing: the first answered MMSI is kept, another is refused", async () => {
    // The MMSI was free input on every call, so any crossing worked as a
    // general AIS proxy for any vessel.
    const ride = (await create(base)).body.data;
    const ok = {
      status: "ok" as const,
      position: {
        mmsi: "211123456",
        vesselName: "PREMIUM",
        lat: 38,
        lon: 128,
        speedKnots: 10,
        courseDegrees: 90,
        receivedAt: "2026-09-20T09:30:00.000Z",
        observedAt: null,
      },
    };
    jest.mocked(lookupVessel).mockReset().mockResolvedValue(ok);
    const url = `/api/v1/ferry/${ride.id}/live-position`;
    expect((await request(app).get(`${url}?mmsi=211123456`).set("Cookie", cookie)).status).toBe(
      200
    );
    expect(lookupVessel).toHaveBeenCalledWith("211123456", userId);
    const stored = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(stored.vesselMmsi).toBe("211123456");

    const other = await request(app).get(`${url}?mmsi=211999999`).set("Cookie", cookie);
    expect(other.status).toBe(400);
    expect(other.body.field).toBe("mmsi");
    expect(lookupVessel).toHaveBeenCalledTimes(1);

    // Without a query the bound vessel is read.
    expect((await request(app).get(url).set("Cookie", cookie)).status).toBe(200);
    expect(lookupVessel).toHaveBeenLastCalledWith("211123456", userId);

    // The crossing's editor can rebind it.
    await request(app)
      .patch(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .send({ vesselMmsi: "211999999" })
      .expect(200);
    expect((await request(app).get(`${url}?mmsi=211999999`).set("Cookie", cookie)).status).toBe(
      200
    );
  });

  it("refuses stale edits and deletes, and permits a delete of the current version", async () => {
    const created = await create(base);
    const ride = created.body.data;
    expect(created.status).toBe(201);
    const updated = await request(app)
      .patch(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .send({ notes: "first edit", baseVersion: ride.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.updatedAt).not.toBe(ride.updatedAt);
    await request(app)
      .patch(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .send({ notes: "stale edit", baseVersion: ride.updatedAt })
      .expect(409);
    await request(app)
      .delete(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .set("If-Match", ride.updatedAt)
      .expect(409);
    const stored = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(stored.notes).toBe("first edit");
    await request(app)
      .delete(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .set("If-Match", stored.updatedAt.toISOString())
      .expect(204);
  });

  it("answers a stale edit and delete with the crossing as it is now, like every other domain", async () => {
    // The 409 carried only `{error, code}`, so a client could not show what
    // changed or retry on the current version without another read.
    const ride = (await create(base)).body.data;
    await request(app)
      .patch(`/api/v1/ferry/${ride.id}`)
      .set("Cookie", cookie)
      .send({ notes: "first edit", baseVersion: ride.updatedAt })
      .expect(200);
    const stored = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    for (const res of [
      await request(app)
        .patch(`/api/v1/ferry/${ride.id}`)
        .set("Cookie", cookie)
        .send({ notes: "stale", baseVersion: ride.updatedAt }),
      await request(app)
        .delete(`/api/v1/ferry/${ride.id}`)
        .set("Cookie", cookie)
        .set("If-Match", ride.updatedAt),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "VERSION_CONFLICT",
        entity: "ferry_journey",
        id: ride.id,
        baseVersion: ride.updatedAt,
        currentVersion: stored.updatedAt.toISOString(),
        changedFields: null,
        current: { id: ride.id, notes: "first edit" },
      });
    }
  });

  it("answers 404, not a version conflict, when a racing delete removed the crossing first", async () => {
    const ride = (await create(base)).body.data;
    // The delete runs in a transaction beside its share propagation, so the
    // other device's delete is slipped in just before that transaction opens —
    // between the lookup and this delete, as before.
    const original = prisma.$transaction.bind(prisma) as (fn: unknown) => Promise<unknown>;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce((async (fn: unknown) => {
      await prisma.ferryJourney.delete({ where: { id: ride.id } });
      return original(fn);
    }) as never);
    try {
      const res = await request(app)
        .delete(`/api/v1/ferry/${ride.id}`)
        .set("Cookie", cookie)
        .set("If-Match", ride.updatedAt);
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });

  it("allows only one concurrent edit based on the same version", async () => {
    const created = await create(base);
    const ride = created.body.data;
    const replies = await Promise.all(
      ["one", "two"].map((notes) =>
        request(app)
          .patch(`/api/v1/ferry/${ride.id}`)
          .set("Cookie", cookie)
          .send({ notes, baseVersion: ride.updatedAt })
      )
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
