import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateApiToken } from "../../../utils/apiTokens";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

// The instance beta switch is a global row other suites flip; the gate itself is tested in
// travplanBetaGate.integration.test.ts.
jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));
import { emptyState, bookingSchema, itemSchema } from "../schema";
import { hash } from "../store";
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);
let owner: string, other: string, admin: string;
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const get = (url: string, who = owner) =>
  request(app)
    .get("/api/v1" + url)
    .set("Cookie", cookie(who));
const post = (url: string, body: object, who = owner) =>
  request(app)
    .post("/api/v1" + url)
    .set("Cookie", cookie(who))
    .send(body);
beforeAll(async () => {
  const rows = await Promise.all(
    [false, false, true].map((isAdmin) =>
      prisma.user.create({
        data: {
          username: "plan-test-" + randomUUID(),
          passwordHash: "not-a-login-password",
          isAdmin,
        },
      })
    )
  );
  [owner, other, admin] = rows.map((r) => r.id);
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function create() {
  const response = await post("/travplan/plans", {
    name: "Integration trip",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", startDay: "2026-11-12", endDay: "2026-11-19" },
  });
  expect(response.status).toBe(201);
  return response.body;
}
async function write(
  plan: { tripId: string; revision: number },
  operation: unknown,
  clientRef = randomUUID()
) {
  return post("/trips/" + plan.tripId + "/plan/mutations", {
    operation,
    clientRef,
    baseRevision: plan.revision,
  });
}
describe("Travel plan transactions against an isolated PostgreSQL database", () => {
  it("requires auth and limits config writes to an administrator", async () => {
    expect((await request(app).get("/api/v1/travplan/plans")).status).toBe(401);
    expect((await get("/travplan/config")).status).toBe(403);
    expect((await get("/travplan/config", admin)).status).toBe(200);
  });
  // Admin → Instanz → TravPlan (2026-10-26) saves the switch alone; the daily limits it never
  // loaded must survive, and an empty body is still a mistake.
  it("saves the switch alone and keeps the daily limits", async () => {
    const patch = (body: object, who = admin) =>
      request(app).patch("/api/v1/travplan/config").set("Cookie", cookie(who)).send(body);
    const before = await prisma.travelPlanConfig.findUniqueOrThrow({ where: { id: "default" } });
    try {
      await prisma.travelPlanConfig.update({
        where: { id: "default" },
        data: { aiDailyLimit: 7, weatherDailyLimit: 15 },
      });
      const off = await patch({ enabled: false });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ enabled: false, aiDailyLimit: 7, weatherDailyLimit: 15 });
      expect((await patch({})).status).toBe(400);
      expect((await patch({ enabled: true }, owner)).status).toBe(403);
    } finally {
      await prisma.travelPlanConfig.update({
        where: { id: "default" },
        data: {
          enabled: before.enabled,
          aiDailyLimit: before.aiDailyLimit,
          weatherDailyLimit: before.weatherDailyLimit,
        },
      });
    }
  });
  it("gives the plan's new trip the account's chosen colour (forgejo#321)", async () => {
    await prisma.userSettings.upsert({
      where: { userId: owner },
      create: { userId: owner, data: {}, tripDefaultColor: "#f472b6" },
      update: { tripDefaultColor: "#f472b6" },
    });
    try {
      const p = await create();
      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: p.tripId } });
      expect(trip.color).toBe("#f472b6");
    } finally {
      await prisma.userSettings.update({
        where: { userId: owner },
        data: { tripDefaultColor: null },
      });
    }
  });
  it("hides a stranger’s plan on both reads and writes", async () => {
    const p = await create();
    expect((await get("/trips/" + p.tripId + "/plan", other)).status).toBe(404);
    const result = await post(
      "/trips/" + p.tripId + "/plan/mutations",
      { clientRef: randomUUID(), baseRevision: 1, operation: { type: "handover" } },
      other
    );
    expect(result.status).toBe(404);
  });
  it("replays an identical mutation exactly once and rejects key reuse", async () => {
    const p = await create(),
      clientRef = randomUUID(),
      operation = { type: "settings", values: { budget: 2500 } };
    const a = await write(p, operation, clientRef),
      b = await write(p, operation, clientRef);
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(await prisma.travelPlanMutation.count({ where: { planId: p.id } })).toBe(1);
    expect((await write(p, { type: "settings", values: { budget: 2600 } }, clientRef)).status).toBe(
      409
    );
  });
  it("arbitrates concurrent edits by revision rather than last write wins", async () => {
    const p = await create(),
      responses = await Promise.all([
        write(p, { type: "settings", values: { budget: 1000 } }),
        write(p, { type: "settings", values: { budget: 2000 } }),
      ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get("/trips/" + p.tripId + "/plan")).body.revision).toBe(2);
  });
  it("undoes the latest mutation using a new, increasing revision", async () => {
    const p = await create(),
      a = await write(p, { type: "settings", values: { budget: 1000 } }),
      b = await write(a.body, { type: "undo", mutationId: a.body.lastMutationId });
    expect(b.status).toBe(200);
    expect(b.body.revision).toBe(3);
    expect(b.body.state.budget).toBeNull();
    expect((await write(b.body, { type: "undo", mutationId: a.body.lastMutationId })).status).toBe(
      409
    );
  });
  it("imports planning bookings without creating countable flights or stays", async () => {
    const p = await create(),
      before = await prisma.flight.count({ where: { userId: owner } });
    const booking = bookingSchema.parse({
      id: randomUUID(),
      kind: "flight",
      title: "Past planned flight",
      reference: "PLAN-" + randomUUID(),
      provider: "",
      day: "2013-01-01",
      endDay: null,
      time: "10:00",
      timezone: null,
      amount: 600,
      paid: 0,
      currency: "EUR",
      place: "",
      documentIds: [],
      source: "manual",
      details: {},
    });
    const a = await write(p, { type: "upsert", collection: "bookings", value: booking });
    expect(a.status).toBe(200);
    expect(a.body.state.items[0].execution).toBe("unconfirmed");
    expect(await prisma.flight.count({ where: { userId: owner } })).toBe(before);
    const b = await write(a.body, { type: "handover" });
    expect(b.status).toBe(200);
    expect(await prisma.flight.count({ where: { userId: owner } })).toBe(before);
    expect(await prisma.lodgingStay.count({ where: { userId: owner, tripId: p.tripId } })).toBe(0);
  });
  it("only writes a journal experience on explicit confirmation, and reverses it on undo", async () => {
    const p = await create(),
      item = itemSchema.parse({
        id: randomUUID(),
        title: "Actual walk",
        kind: "activity",
        day: "2026-01-01",
        time: null,
        duration: 30,
        timezone: null,
        place: "",
        note: "A remembered walk",
        booked: false,
        bookingId: null,
        execution: "unconfirmed",
        source: null,
      });
    const a = await write(p, { type: "upsert", collection: "items", value: item });
    expect(a.status).toBe(200);
    expect(await prisma.tripJournalEntry.count({ where: { tripId: p.tripId } })).toBe(0);
    const b = await write(a.body, { type: "execution", id: item.id, execution: "confirmed" });
    expect(b.status).toBe(200);
    expect(await prisma.tripJournalEntry.count({ where: { tripId: p.tripId } })).toBe(1);
    const c = await write(b.body, { type: "undo", mutationId: b.body.lastMutationId });
    expect(c.status).toBe(200);
    expect(await prisma.tripJournalEntry.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it("rejects stale proposals and never lets them change booked anchors", async () => {
    const p = await create(),
      item = itemSchema.parse({
        id: randomUUID(),
        title: "A flexible walk",
        kind: "activity",
        day: "2026-11-12",
        time: "17:00",
        duration: 30,
        timezone: null,
        place: "",
        note: "",
        booked: false,
        bookingId: null,
        execution: "unconfirmed",
        source: null,
      });
    const a = await write(p, { type: "upsert", collection: "items", value: item }),
      proposal = await prisma.travelPlanProposal.create({
        data: {
          planId: p.id,
          baseRevision: a.body.revision,
          inputHash: hash(a.body.state),
          provider: "test",
          model: "test",
          expiresAt: new Date(Date.now() + 3600000),
          content: {
            summary: "Move the walk",
            assumptions: [],
            changes: [
              { id: item.id, day: "2026-11-13", time: "10:00", reason: "Rest after arrival" },
            ],
          },
        },
      });
    const b = await write(a.body, { type: "settings", values: { pace: "relaxed" } });
    expect((await write(b.body, { type: "proposal", proposalId: proposal.id })).status).toBe(409);
  });
  it("does not retain a document reference belonging to another trip", async () => {
    const p = await create(),
      booking = bookingSchema.parse({
        id: randomUUID(),
        kind: "hotel",
        title: "A hotel",
        reference: null,
        provider: "",
        day: null,
        endDay: null,
        time: null,
        timezone: null,
        amount: null,
        paid: 0,
        currency: "EUR",
        place: "",
        documentIds: [randomUUID()],
        source: "manual",
        details: {},
      });
    expect(
      (await write(p, { type: "upsert", collection: "bookings", value: booking })).status
    ).toBe(404);
    expect((await get("/trips/" + p.tripId + "/plan")).body.revision).toBe(1);
  });
  it("keeps planning write controls active when the server flag is off", async () => {
    const p = await create();
    await prisma.travelPlanConfig.update({ where: { id: "default" }, data: { enabled: false } });
    expect((await write(p, { type: "handover" })).status).toBe(403);
    expect((await get("/trips/" + p.tripId + "/plan")).status).toBe(200);
    await prisma.travelPlanConfig.update({ where: { id: "default" }, data: { enabled: true } });
  });
  it("materializes a confirmed flight exactly once and removes only that untouched evidence on undo", async () => {
    for (const [iata, lat, lon] of [
      ["XAA", 50, 8],
      ["XBB", 40, -73],
    ] as const) {
      const existing = await prisma.airport.findFirst({ where: { iata, isClosed: false } });
      if (!existing)
        await prisma.airport.create({
          data: { iata, name: "Isolated test airport", lat, lon, timezone: "UTC" },
        });
    }
    const p = await create(),
      booking = bookingSchema.parse({
        id: randomUUID(),
        kind: "flight",
        title: "A confirmed journey",
        reference: "EXECT1",
        provider: "",
        day: "2026-01-01",
        endDay: null,
        time: "09:00",
        timezone: "UTC",
        arrivalDay: "2026-01-01",
        arrivalTime: "12:00",
        arrivalTimezone: "UTC",
        originPlace: "XAA",
        place: "XBB",
        amount: 200,
        paid: 200,
        currency: "EUR",
        documentIds: [],
        source: "manual",
        details: {},
      });
    const a = await write(p, { type: "upsert", collection: "bookings", value: booking });
    const item = a.body.state.items[0],
      ref = randomUUID();
    const b = await write(a.body, { type: "execution", id: item.id, execution: "confirmed" }, ref);
    expect(b.status).toBe(200);
    expect(await prisma.flight.count({ where: { tripId: p.tripId } })).toBe(1);
    expect(await prisma.booking.count({ where: { tripId: p.tripId } })).toBe(1);
    expect(
      (await write(a.body, { type: "execution", id: item.id, execution: "confirmed" }, ref)).body
    ).toEqual(b.body);
    const c = await write(b.body, { type: "undo", mutationId: b.body.lastMutationId });
    expect(c.status).toBe(200);
    expect(await prisma.flight.count({ where: { tripId: p.tripId } })).toBe(0);
    expect(await prisma.booking.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it("materializes a confirmed hotel stay with qualified local dates and reverses its untouched place", async () => {
    const p = await create(),
      booking = bookingSchema.parse({
        id: randomUUID(),
        kind: "hotel",
        title: "Isolated plan hotel " + randomUUID(),
        reference: null,
        provider: "",
        day: "2026-01-01",
        endDay: "2026-01-03",
        time: null,
        timezone: "Atlantic/Madeira",
        amount: 200,
        paid: 200,
        currency: "EUR",
        place: "Funchal",
        documentIds: [],
        source: "manual",
        details: { country: "Portugal", city: "Funchal" },
      });
    const a = await write(p, { type: "upsert", collection: "bookings", value: booking }),
      b = await write(a.body, {
        type: "execution",
        id: a.body.state.items[0].id,
        execution: "confirmed",
      });
    expect(b.status).toBe(200);
    expect(await prisma.lodgingStay.count({ where: { tripId: p.tripId } })).toBe(1);
    const source = b.body.state.items[0].source;
    const c = await write(b.body, { type: "undo", mutationId: b.body.lastMutationId });
    expect(c.status).toBe(200);
    expect(await prisma.lodgingStay.count({ where: { tripId: p.tripId } })).toBe(0);
    expect(await prisma.lodging.count({ where: { id: source.auxId } })).toBe(0);
  });
  it("refuses future execution before creating countable data", async () => {
    const p = await create(),
      item = itemSchema.parse({
        id: randomUUID(),
        title: "Future experience",
        kind: "activity",
        day: "2099-01-01",
        time: null,
        duration: 30,
        timezone: "UTC",
        place: "",
        note: "",
        booked: false,
        bookingId: null,
        execution: "unconfirmed",
        source: null,
      });
    const a = await write(p, { type: "upsert", collection: "items", value: item });
    expect(
      (await write(a.body, { type: "execution", id: item.id, execution: "confirmed" })).status
    ).toBe(400);
    expect(await prisma.tripJournalEntry.count({ where: { tripId: p.tripId } })).toBe(0);
  });

  it("replays trip creation after later edits", async () => {
    const body = {
      name: "Creation replay",
      clientRef: randomUUID(),
      settings: { destination: "Madeira" },
    };
    const p = await post("/travplan/plans", body);
    expect(p.status).toBe(201);
    await write(p.body, { type: "settings", values: { pace: "relaxed" }, name: "Renamed later" });
    const replay = await post("/travplan/plans", body);
    expect(replay.status).toBe(201);
    expect(replay.body.tripId).toBe(p.body.tripId);
    expect((await post("/travplan/plans", { ...body, name: "Different input" })).status).toBe(409);
  });
  it("adopts owned actual bookings without creating duplicate evidence or prices", async () => {
    const trip = await prisma.trip.create({ data: { userId: owner, name: "Existing trip" } }),
      b = await prisma.booking.create({
        data: { userId: owner, tripId: trip.id, pnr: "SHARED", price: 600, currency: "EUR" },
      });
    for (const [dep, arr] of [
      ["FRA", "FNC"],
      ["FNC", "FRA"],
    ])
      await prisma.flight.create({
        data: {
          userId: owner,
          tripId: trip.id,
          bookingId: b.id,
          depIata: dep,
          arrIata: arr,
          depLat: 1,
          depLon: 1,
          arrLat: 2,
          arrLon: 2,
          status: "historical",
          departureTime: new Date("2026-01-01T10:00:00Z"),
          depTimezone: "UTC",
          depPrecision: "minute",
        },
      });
    const p = await post("/travplan/plans", {
      name: trip.name,
      tripId: trip.id,
      clientRef: randomUUID(),
      settings: {},
    });
    expect(p.status).toBe(201);
    expect(p.body.state.items).toHaveLength(2);
    expect(p.body.budget.total).toBe(600);
    const fresh = await write(p.body, { type: "refresh_existing" });
    expect(fresh.status).toBe(200);
    expect(fresh.body.state.items).toHaveLength(2);
    expect(await prisma.flight.count({ where: { tripId: trip.id } })).toBe(2);
    const unlinked = await write(fresh.body, {
      type: "execution",
      id: fresh.body.state.items[0].id,
      execution: "unconfirmed",
    });
    expect(unlinked.status).toBe(200);
    expect(await prisma.flight.count({ where: { tripId: trip.id } })).toBe(2);
  });
  it("does not accept another user’s actual record as travel evidence", async () => {
    const p = await create(),
      b = bookingSchema.parse({
        id: randomUUID(),
        kind: "rail",
        title: "Train",
        reference: null,
        provider: "",
        day: null,
        endDay: null,
        time: null,
        timezone: null,
        amount: null,
        paid: 0,
        currency: "EUR",
        place: "",
        documentIds: [],
        source: "manual",
        details: {},
      });
    const a = await write(p, { type: "upsert", collection: "bookings", value: b });
    expect(
      (
        await write(a.body, {
          type: "link_actual",
          id: a.body.state.items[0].id,
          sourceId: randomUUID(),
        })
      ).status
    ).toBe(404);
  });
  it("allows a read PAT to read but never mutate a plan", async () => {
    const p = await create(),
      token = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: owner,
        label: "Plan read scope",
        lookupHash: token.lookupHash,
        hash: token.hash,
        scope: "read",
      },
    });
    expect(
      (
        await request(app)
          .get("/api/v1/trips/" + p.tripId + "/plan")
          .set("Authorization", "Bearer " + token.plaintext)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/trips/" + p.tripId + "/plan/mutations")
          .set("Authorization", "Bearer " + token.plaintext)
          .send({
            baseRevision: p.revision,
            clientRef: randomUUID(),
            operation: { type: "handover" },
          })
      ).status
    ).toBe(403);
  });
  it("reserves a revision before creating physical evidence in concurrent confirmations", async () => {
    const p = await create(),
      b = bookingSchema.parse({
        id: randomUUID(),
        kind: "hotel",
        title: "Concurrent hotel " + randomUUID(),
        reference: null,
        provider: "",
        day: "2026-01-01",
        endDay: "2026-01-03",
        time: null,
        timezone: "UTC",
        amount: null,
        paid: 0,
        currency: "EUR",
        place: "",
        documentIds: [],
        source: "manual",
        details: {},
      }),
      a = await write(p, { type: "upsert", collection: "bookings", value: b });
    const op = { type: "execution", id: a.body.state.items[0].id, execution: "confirmed" };
    const results = await Promise.all([write(a.body, op), write(a.body, op)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.lodgingStay.count({ where: { tripId: p.tripId } })).toBe(1);
  });
  it("lists only lightweight summaries without private notes or document references", async () => {
    const p = await create(),
      response = await get("/travplan/plans");
    const summary = response.body.plans.find((r: { tripId: string }) => r.tripId === p.tripId);
    expect(summary).toMatchObject({ destination: "Madeira", ideasCount: 0, bookingsCount: 0 });
    expect(summary).not.toHaveProperty("state");
  });
  it("mirrors planned dates into an empty canonical trip while creating no actual travel records", async () => {
    const p = await create();
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: p.tripId } })).startDay
        ?.toISOString()
        .slice(0, 10)
    ).toBe("2026-11-12");
    await write(p, { type: "settings", values: { startDay: "2026-11-13" } });
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: p.tripId } })).startDay
        ?.toISOString()
        .slice(0, 10)
    ).toBe("2026-11-13");
    expect(await prisma.flight.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it("does not reuse an unrelated lodging based only on a shared name", async () => {
    const p = await create(),
      name = "Ambiguous hotel " + randomUUID(),
      old = await prisma.lodging.create({
        data: { userId: owner, name, city: null, country: "Germany", isoCountryCode: "DE" },
      });
    const booking = bookingSchema.parse({
      id: randomUUID(),
      kind: "hotel",
      title: name,
      reference: null,
      provider: "",
      day: "2026-01-01",
      endDay: "2026-01-03",
      time: null,
      timezone: "UTC",
      amount: null,
      paid: 0,
      currency: "EUR",
      place: "",
      documentIds: [],
      source: "manual",
      details: {},
    });
    const a = await write(p, { type: "upsert", collection: "bookings", value: booking }),
      b = await write(a.body, {
        type: "execution",
        id: a.body.state.items[0].id,
        execution: "confirmed",
      });
    expect(b.status).toBe(200);
    expect(b.body.state.items[0].source.auxId).not.toBe(old.id);
  });
  it("filters foreign legacy child records when adopting an owned trip", async () => {
    const trip = await prisma.trip.create({ data: { userId: owner, name: "Owned parent" } });
    await prisma.flight.create({
      data: {
        userId: other,
        tripId: trip.id,
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
        flightNumber: "PRIVATE",
      },
    });
    const p = await post("/travplan/plans", {
      name: trip.name,
      tripId: trip.id,
      clientRef: randomUUID(),
    });
    expect(p.status).toBe(201);
    expect(p.body.state.items).toHaveLength(0);
  });
});

it.each(["flight", "hotel"] as const)(
  "shares explicitly confirmed %s facts and leaves recipients' copies intact on undo",
  async (kind) => {
    if (kind === "flight") {
      for (const [iata, lat, lon] of [
        ["XAA", 50, 8],
        ["XBB", 40, -73],
      ] as const) {
        if (!(await prisma.airport.findFirst({ where: { iata, isClosed: false } })))
          await prisma.airport.create({
            data: { iata, name: "Isolated sharing airport", lat, lon, timezone: "UTC" },
          });
      }
    }
    const plan = await create();
    // A shared trip carries changes only between accounts that consented to each
    // other (trip-sharing rule since 2026-10-16); without this row nothing is copied.
    await prisma.shareConsent.deleteMany({ where: { requesterId: owner, targetId: other } });
    await prisma.shareConsent.create({
      data: { requesterId: owner, targetId: other, status: "accepted", decidedAt: new Date() },
    });
    const group = await prisma.tripShareGroup.create({ data: { createdById: owner } });
    await prisma.trip.update({ where: { id: plan.tripId }, data: { shareGroupId: group.id } });
    const recipient = await prisma.trip.create({
      data: { userId: other, name: "Shared plan result", shareGroupId: group.id },
    });
    const booking = bookingSchema.parse({
      id: randomUUID(),
      kind,
      title: "Private planning booking " + randomUUID(),
      reference: "PRIVATE-PNR",
      provider: "",
      day: "2026-01-01",
      endDay: kind === "hotel" ? "2026-01-03" : null,
      time: "09:00",
      timezone: "UTC",
      arrivalDay: "2026-01-01",
      arrivalTime: "12:00",
      arrivalTimezone: "UTC",
      originPlace: "XAA",
      place: kind === "flight" ? "XBB" : "Funchal",
      city: "Funchal",
      country: "Portugal",
      address: "Test Street 1",
      amount: 200,
      paid: 200,
      currency: "EUR",
      documentIds: [],
      source: "manual",
      details: {},
    });
    const prepared = await write(plan, { type: "upsert", collection: "bookings", value: booking });
    expect(prepared.status).toBe(200);
    const copies = () =>
      kind === "flight"
        ? prisma.flight.findMany({ where: { tripId: recipient.id } })
        : prisma.lodgingStay.findMany({ where: { tripId: recipient.id } });
    expect(await copies()).toHaveLength(0);
    const confirmed = await write(prepared.body, {
      type: "execution",
      id: prepared.body.state.items[0].id,
      execution: "confirmed",
    });
    expect(confirmed.status).toBe(200);
    const source = confirmed.body.state.items[0].source;
    const own =
      kind === "flight"
        ? await prisma.flight.findUniqueOrThrow({ where: { id: source.id } })
        : await prisma.lodgingStay.findUniqueOrThrow({ where: { id: source.id } });
    const received = await copies();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      userId: other,
      tripId: recipient.id,
      bookingId: null,
      bookingReference: null,
      shareKey: own.shareKey,
    });
    expect(own.shareKey).not.toBeNull();
    expect(received[0]).toHaveProperty(kind === "flight" ? "price" : "totalPrice", null);
    expect(source.version).toBe(own.updatedAt.toISOString());
    const undone = await write(confirmed.body, {
      type: "undo",
      mutationId: confirmed.body.lastMutationId,
    });
    expect(undone.status).toBe(200);
    expect(
      kind === "flight"
        ? await prisma.flight.count({ where: { id: source.id } })
        : await prisma.lodgingStay.count({ where: { id: source.id } })
    ).toBe(0);
    expect(await copies()).toHaveLength(1);
    const notices = await prisma.shareNotice.findMany({
      where: { groupId: group.id, userId: other },
    });
    expect(notices.map((n) => n.kind).sort()).toEqual(["created", "deleted"]);
  }
);

describe("placeholders over HTTP", () => {
  const placeholder = () =>
    bookingSchema.parse({
      id: randomUUID(),
      kind: "ferry",
      title: "Ferry to Genoa",
      reference: null,
      provider: "",
      day: "2027-05-19",
      endDay: null,
      time: null,
      timezone: null,
      amount: null,
      paid: 0,
      currency: "EUR",
      place: "Genoa",
      originPlace: "Palermo",
      documentIds: [],
      source: "manual",
      details: {},
      placeholder: true,
      estimate: { amount: 520, currency: "EUR" },
    });
  it("replace_placeholder is undoable and restores the placeholder", async () => {
    const p = await create(),
      ph = placeholder(),
      a = await write(p, { type: "upsert", collection: "bookings", value: ph });
    expect(a.status).toBe(200);
    const real = { ...ph, placeholder: false, estimate: null, amount: 548, provider: "Grimaldi" };
    const b = await write(a.body, {
      type: "replace_placeholder",
      placeholderId: ph.id,
      value: { ...real, id: randomUUID() },
    });
    expect(b.status).toBe(200);
    expect(b.body.state.bookings[0]).toMatchObject({ id: ph.id, placeholder: false, amount: 548 });
    const c = await write(b.body, { type: "undo", mutationId: b.body.lastMutationId });
    expect(c.status).toBe(200);
    expect(c.body.state.bookings[0].placeholder).toBe(true);
    expect(c.body.state.bookings[0].estimate.amount).toBe(520);
  });
  it("answers placeholder matches for the owner only", async () => {
    const p = await create(),
      ph = placeholder(),
      a = await write(p, { type: "upsert", collection: "bookings", value: ph });
    expect(a.status).toBe(200);
    const candidate = {
      ...ph,
      id: randomUUID(),
      placeholder: false,
      estimate: null,
      day: "2027-05-20",
    };
    const url = "/trips/" + p.tripId + "/plan/placeholder-matches";
    const ok = await post(url, { booking: candidate });
    expect(ok.status).toBe(200);
    expect(ok.body.matches).toHaveLength(1);
    expect(ok.body.matches[0].bookingId).toBe(ph.id);
    expect((await post(url, { booking: candidate }, other)).status).toBe(404);
    expect((await post(url, { booking: { nonsense: true } })).status).toBe(400);
  });
});
