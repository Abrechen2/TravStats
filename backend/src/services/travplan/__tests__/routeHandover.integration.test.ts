import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);
let owner: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: owner, epoch: 0 }, JWT_SECRET);
const post = (u: string, b: object) =>
  request(app)
    .post("/api/v1" + u)
    .set("Cookie", cookie())
    .send(b);
const dayPlus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { username: "plan-handover-" + randomUUID(), passwordHash: "x" },
    })
  ).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: owner } });
  await prisma.$disconnect();
});

const place = (name: string, lat: number, lon: number) => ({
  name,
  lat,
  lon,
  country: "DE",
  zone: "Europe/Berlin",
  ref: null,
});
const booking = (over: Record<string, unknown>) => ({
  id: randomUUID(),
  kind: "hotel",
  title: "Camping Strand",
  reference: "CS-1",
  provider: "",
  day: null,
  endDay: null,
  time: null,
  timezone: "Europe/Berlin",
  amount: 60,
  paid: 0,
  currency: "EUR",
  place: "Kiel",
  documentIds: [],
  source: "manual",
  details: {},
  placeholder: false,
  estimate: null,
  stageId: null,
  ...over,
});

/** A (2 nights, booked pitch) -> ferry -> B (1 night) -> drive -> C (30 nights) -> drive -> D (future). */
async function routePlan(opts: { placeholderNight?: boolean } = {}) {
  const created = (
    await post("/travplan/plans", {
      name: "Handover test",
      clientRef: randomUUID(),
      settings: { destination: "Ostsee", startDay: dayPlus(-6), endDay: dayPlus(40) },
    })
  ).body;
  let revision: number = created.revision;
  const send = async (operation: object) => {
    const r = await post("/trips/" + created.tripId + "/plan/mutations", {
      clientRef: randomUUID(),
      baseRevision: revision,
      operation,
    });
    expect(r.status).toBe(200);
    revision = r.body.revision;
    return r.body;
  };
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
  const night = booking({
    day: dayPlus(-6),
    endDay: dayPlus(-4),
    placeholder: !!opts.placeholderNight,
    estimate: opts.placeholderNight ? { amount: 60, currency: "EUR" } : null,
    reference: opts.placeholderNight ? null : "CS-1",
    amount: opts.placeholderNight ? null : 60,
  });
  const ferry = booking({
    kind: "ferry",
    title: "Kiel - Gothenburg",
    day: dayPlus(-4),
    time: "18:00",
    arrivalDay: dayPlus(-3),
    arrivalTime: "09:00",
    provider: "Stena Line",
    reference: "STENA-9",
    originPlace: "Kiel",
    place: "Gothenburg",
    amount: 180,
  });
  await send({ type: "route_settings", shape: "route" });
  await send({ type: "upsert", collection: "bookings", value: night });
  await send({ type: "upsert", collection: "bookings", value: ferry });
  const stations: [string, string, number, number, number, object][] = [
    [ids.a, "Kiel", 54.32, 10.14, 2, { kind: "booked", bookingId: night.id }],
    [ids.b, "Gothenburg", 57.7, 11.97, 1, { kind: "spontaneous" }],
    [ids.c, "Oslo", 59.91, 10.75, 30, { kind: "pitch" }],
    [ids.d, "Bergen", 60.39, 5.32, 0, { kind: "spontaneous" }],
  ];
  for (const [id, title, lat, lon, nights, n] of stations)
    await send({
      type: "upsert",
      collection: "stations",
      value: {
        id,
        title,
        place: place(title, lat, lon),
        nights,
        pinnedDay: null,
        night: n,
        note: "",
      },
    });
  const stage = (from: string, to: string, extra: object) => ({
    id: randomUUID(),
    fromStationId: from,
    toStationId: to,
    mode: "drive",
    departDay: null,
    departTime: null,
    durationMinutes: 120,
    distanceKm: 100,
    metricsSource: "user",
    fallbackReason: null,
    bookingId: null,
    overnight: false,
    note: "",
    ...extra,
  });
  await send({
    type: "upsert",
    collection: "stages",
    value: stage(ids.a, ids.b, {
      mode: "ferry",
      bookingId: ferry.id,
      departDay: dayPlus(-4),
      departTime: "18:00",
      durationMinutes: 900,
      metricsSource: "booking",
    }),
  });
  await send({ type: "upsert", collection: "stages", value: stage(ids.b, ids.c, {}) });
  await send({ type: "upsert", collection: "stages", value: stage(ids.c, ids.d, {}) });
  return {
    tripId: created.tripId as string,
    ids,
    get revision() {
      return revision;
    },
    handover: async (stationId: string) => {
      const r = await post("/trips/" + created.tripId + "/plan/mutations", {
        clientRef: randomUUID(),
        baseRevision: revision,
        operation: { type: "station_handover", stationId },
      });
      if (r.status === 200) revision = r.body.revision;
      return r;
    },
    withdraw: async (stationId: string) => {
      const r = await post("/trips/" + created.tripId + "/plan/mutations", {
        clientRef: randomUUID(),
        baseRevision: revision,
        operation: { type: "station_withdraw", stationId },
      });
      if (r.status === 200) revision = r.body.revision;
      return r;
    },
    undo: (mutationId: string) =>
      post("/trips/" + created.tripId + "/plan/mutations", {
        clientRef: randomUUID(),
        baseRevision: revision,
        operation: { type: "undo", mutationId },
      }),
  };
}

describe("route plan handover (spec 5.9, C1)", () => {
  it("writes the roadtrip, the stop, a stay for the booked night and the arriving ferry, linked to its leg", async () => {
    const plan = await routePlan();
    const a = await plan.handover(plan.ids.a);
    expect(a.status).toBe(200);
    const roadtripId = a.body.state.roadtripId as string;
    expect(roadtripId).toBeTruthy();
    const linkA = a.body.state.stationLinks.find(
      (l: { stationId: string }) => l.stationId === plan.ids.a
    );
    expect(linkA.created.map((c: { kind: string }) => c.kind).sort()).toEqual([
      "lodging",
      "stay",
      "stop",
    ]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({
      where: { tripId: plan.tripId },
      include: { lodging: true },
    });
    expect(stay.externalRef).toBe("travplan:" + plan.ids.a);
    expect(stay.lodging.type).toBe("hotel");
    const stopA = await prisma.tripStop.findUniqueOrThrow({ where: { id: linkA.tripStopId } });
    expect(stopA).toMatchObject({ routeId: roadtripId, lodgingStayId: stay.id, overnight: true });

    const b = await plan.handover(plan.ids.b);
    expect(b.status).toBe(200);
    expect(b.body.state.roadtripId).toBe(roadtripId);
    const ferry = await prisma.ferryJourney.findFirstOrThrow({
      where: { tripId: plan.tripId },
      include: { roadtripLeg: true },
    });
    expect(ferry).toMatchObject({ externalRef: expect.stringMatching(/^travplan:/) });
    expect(ferry.roadtripLeg).toMatchObject({ mode: "ferry", fromStopId: linkA.tripStopId });
    expect(ferry.bookingReference).toBe("STENA-9");
    expect(await prisma.tripStop.count({ where: { routeId: roadtripId } })).toBe(2);
  });

  it("refuses a station the trip has not reached yet", async () => {
    const plan = await routePlan();
    const d = await plan.handover(plan.ids.d);
    expect(d.status).toBe(400);
    expect(d.body.error?.code ?? d.body.code).toBe("PLAN_STATION_FUTURE");
    expect(await prisma.tripStop.count({ where: { route: { tripId: plan.tripId } } })).toBe(0);
  });

  it("never turns a placeholder night into a stay (C4)", async () => {
    const plan = await routePlan({ placeholderNight: true });
    const a = await plan.handover(plan.ids.a);
    expect(a.status).toBe(200);
    expect(await prisma.lodgingStay.count({ where: { tripId: plan.tripId } })).toBe(0);
    const link = a.body.state.stationLinks[0];
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: link.tripStopId } });
    expect(stop).toMatchObject({ overnight: true, lodgingStayId: null });
  });

  it("reconciles into the stops the phone appended instead of replacing them", async () => {
    const plan = await routePlan();
    const first = await plan.handover(plan.ids.a);
    const routeId = first.body.state.roadtripId as string;
    // The phone appended a stop at Gothenburg on the arrival day and another one further on.
    const phoneHere = await prisma.tripStop.create({
      data: {
        routeId,
        routeOrderIdx: 1,
        title: "Tonight here",
        lat: 57.7001,
        lon: 11.9701,
        startDate: new Date(dayPlus(-3) + "T00:00:00Z"),
        endDate: new Date(dayPlus(-3) + "T00:00:00Z"),
        overnight: true,
        domain: "roadtrip",
      },
    });
    const phoneLater = await prisma.tripStop.create({
      data: {
        routeId,
        routeOrderIdx: 2,
        title: "Phone only",
        lat: 58.5,
        lon: 11.0,
        startDate: new Date(dayPlus(-2) + "T00:00:00Z"),
        overnight: true,
        domain: "roadtrip",
      },
    });
    const b = await plan.handover(plan.ids.b);
    expect(b.status).toBe(200);
    const stops = await prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
    });
    expect(stops.map((s) => s.title)).toEqual(["Kiel", "Tonight here", "Phone only"]);
    expect(stops[1].id).toBe(phoneHere.id);
    expect(stops[2].id).toBe(phoneLater.id);
  });

  it("withdraws only untouched evidence and keeps what the user edited", async () => {
    const plan = await routePlan();
    await plan.handover(plan.ids.a);
    const b = await plan.handover(plan.ids.b);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { tripId: plan.tripId } });
    // The user wrote a note on the stay after the handover.
    await prisma.lodgingStay.update({ where: { id: stay.id }, data: { notes: "Lovely host" } });

    const gone = await plan.withdraw(plan.ids.b);
    expect(gone.status).toBe(200);
    expect(await prisma.ferryJourney.count({ where: { tripId: plan.tripId } })).toBe(0);
    expect(await prisma.tripRouteLeg.count({ where: { route: { tripId: plan.tripId } } })).toBe(0);
    expect(gone.body.state.stationLinks.map((l: { stationId: string }) => l.stationId)).toEqual([
      plan.ids.a,
    ]);

    const kept = await plan.withdraw(plan.ids.a);
    expect(kept.status).toBe(200);
    expect(await prisma.lodgingStay.count({ where: { id: stay.id } })).toBe(1);
    const link = kept.body.state.stationLinks.find(
      (l: { stationId: string }) => l.stationId === plan.ids.a
    );
    expect(link.created.map((c: { kind: string }) => c.kind).sort()).toEqual(["lodging", "stay"]);
    expect(b.body.state.stationLinks).toHaveLength(2);
  });

  it("does not offer undo for a handover: the station is withdrawn instead", async () => {
    const plan = await routePlan();
    const a = await plan.handover(plan.ids.a);
    const undo = await plan.undo(a.body.lastMutationId);
    expect(undo.status).toBe(409);
    expect(await prisma.tripStop.count({ where: { route: { tripId: plan.tripId } } })).toBe(1);
  });

  it("keeps the notes and name the phone wrote on a stop the plan adopts", async () => {
    const plan = await routePlan();
    const first = await plan.handover(plan.ids.a);
    const routeId = first.body.state.roadtripId as string;
    const phone = await prisma.tripStop.create({
      data: {
        routeId,
        routeOrderIdx: 1,
        title: "Parkplatz am Hafen",
        notes: "Strom am Pfosten 4",
        lat: 57.7001,
        lon: 11.9701,
        startDate: new Date(dayPlus(-3) + "T00:00:00Z"),
        overnight: true,
        domain: "roadtrip",
      },
    });
    const b = await plan.handover(plan.ids.b);
    expect(b.status).toBe(200);
    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: phone.id } });
    expect(stop).toMatchObject({ title: "Parkplatz am Hafen", notes: "Strom am Pfosten 4" });
  });

  it("does not withdraw a stop whose note the user wrote after the handover", async () => {
    const plan = await routePlan();
    const a = await plan.handover(plan.ids.a);
    const link = a.body.state.stationLinks[0];
    await prisma.tripStop.update({
      where: { id: link.tripStopId },
      data: { notes: "Mein Eintrag" },
    });
    const out = await plan.withdraw(plan.ids.a);
    expect(out.status).toBe(200);
    expect(await prisma.tripStop.count({ where: { id: link.tripStopId } })).toBe(1);
    expect(out.body.state.stationLinks[0].created.map((c: { kind: string }) => c.kind)).toContain(
      "stop"
    );
  });
});
