import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { importSheets } from "../../services/xlsxImport/importSheets";

/**
 * Deleting a roadtrip or tour must not take its costs with it in silence
 * (owner, 2026-10-01, forgejo#140). On a trip the costs become the trip's —
 * their station and leg pins cleared, since the stops go; amount, currency,
 * day, kind and note kept. A section with no trip has nowhere to hand them:
 * the delete is refused with the count until the caller opts in.
 */
describe("deleting a section keeps its costs", () => {
  const USERNAME = `sectiondel-${Date.now()}`;
  let userId: string;
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: USERNAME, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    tripId = (await prisma.trip.create({ data: { userId, name: "Norwegen" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  async function section(onTrip: boolean, kind = "roadtrip") {
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: onTrip ? tripId : null, name: "Fjorde", mode: "road", kind },
    });
    const stop = await prisma.tripStop.create({
      data: { title: "Lom", lat: 61.8, lon: 8.6, routeId: route.id, routeOrderIdx: 0 },
    });
    return { routeId: route.id, stopId: stop.id };
  }

  const cost = (routeId: string, over = {}) =>
    prisma.tripExpense.create({
      data: {
        userId,
        routeId,
        kind: "pitch",
        amount: 350,
        currency: "NOK",
        date: new Date("2026-07-15T00:00:00Z"),
        note: "Stellplatz",
        ...over,
      },
    });

  it("hands a roadtrip's costs to its trip, pins cleared, everything else kept", async () => {
    const { routeId, stopId } = await section(true);
    const pitch = await cost(routeId, { stopId });
    const res = await request(app).delete(`/api/v1/tours/${routeId}`).set("Cookie", cookie);
    expect(res.status).toBe(204);
    const after = await prisma.tripExpense.findUniqueOrThrow({ where: { id: pitch.id } });
    expect({ ...after, amount: after.amount.toNumber() }).toMatchObject({
      tripId,
      routeId: null,
      stopId: null,
      legFromStopId: null,
      legToStopId: null,
      kind: "pitch",
      amount: 350,
      currency: "NOK",
      date: new Date("2026-07-15T00:00:00Z"),
      note: "Stellplatz",
    });
  });

  it("does the same through the trip's own path, for a tour section", async () => {
    const { routeId } = await section(true, "tour");
    const parking = await cost(routeId, { kind: "parking" });
    const res = await request(app)
      .delete(`/api/v1/trips/${tripId}/routes/${routeId}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.tripExpense.findUnique({ where: { id: parking.id } })).toMatchObject({
      tripId,
      routeId: null,
    });
  });

  it("refuses to delete a standalone section with costs, naming how many", async () => {
    const { routeId } = await section(false);
    await cost(routeId);
    await cost(routeId, { kind: "fuel" });
    const res = await request(app).delete(`/api/v1/tours/${routeId}`).set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "SECTION_HAS_EXPENSES", expenseCount: 2 });
    expect(await prisma.tripRoute.count({ where: { id: routeId } })).toBe(1);
    expect(await prisma.tripExpense.count({ where: { routeId } })).toBe(2);
  });

  it("deletes a standalone section and its costs only on the explicit opt-in", async () => {
    const { routeId } = await section(false);
    await cost(routeId);
    const res = await request(app)
      .delete(`/api/v1/tours/${routeId}?deleteExpenses=true`)
      .set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(0);
  });

  it("deletes a standalone section without costs as before", async () => {
    const { routeId } = await section(false);
    const res = await request(app).delete(`/api/v1/tours/${routeId}`).set("Cookie", cookie);
    expect(res.status).toBe(204);
  });

  it("on a trip delete, a roadtrip outlives the trip and keeps its costs", async () => {
    // The trip delete makes a roadtrip standalone (it is a domain of its own),
    // and its costs ride on the roadtrip — nothing to hand over, nothing lost.
    const { routeId } = await section(true);
    await cost(routeId);
    const res = await request(app).delete(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.tripRoute.findUnique({ where: { id: routeId } })).toMatchObject({
      tripId: null,
    });
    expect(await prisma.tripExpense.count({ where: { routeId } })).toBe(1);
  });

  describe("a spreadsheet replace that leaves the section out", () => {
    it("hands a trip roadtrip's costs to the trip and keeps a standalone one with costs", async () => {
      const onTrip = await section(true);
      const standalone = await section(false);
      const onTripCost = await cost(onTrip.routeId, { stopId: onTrip.stopId });
      await cost(standalone.routeId);
      const kept = await prisma.tripRoute.create({
        data: { userId, name: "Bleibt", mode: "road", kind: "roadtrip" },
      });
      await importSheets([{ key: "roadtrips", rows: [{ id: kept.id, name: "Bleibt" }] }], {
        userId,
        mode: "replace",
        dryRun: false,
      });
      expect(await prisma.tripRoute.count({ where: { id: onTrip.routeId } })).toBe(0);
      expect(await prisma.tripExpense.findUnique({ where: { id: onTripCost.id } })).toMatchObject({
        tripId,
        routeId: null,
        stopId: null,
      });
      // Kept, not pruned: deleting it would delete money the file never showed.
      expect(await prisma.tripRoute.count({ where: { id: standalone.routeId } })).toBe(1);
      expect(await prisma.tripExpense.count({ where: { routeId: standalone.routeId } })).toBe(1);
    });
  });
});
