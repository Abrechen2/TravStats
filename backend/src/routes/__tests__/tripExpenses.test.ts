import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * Expenses (forgejo#140): a ferry ticket, a toll, a pitch fee, fuel — on a
 * trip or on a section, optionally pinned to a station or to the way between
 * two. The cases that matter are the refusals: a foreign key proves existence,
 * not ownership, so every id a body names is checked against the caller AND
 * against the trip or section the path names.
 */
describe("expenses", () => {
  const OWNER = `expenses-${Date.now()}`;
  const STRANGER = `expenses-other-${Date.now()}`;
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let otherTripId: string;
  let roadtripId: string;
  let stationIds: string[];

  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: OWNER, passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: STRANGER, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.tripRoute.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    tripId = (await prisma.trip.create({ data: { userId, name: "Norwegen" } })).id;
    otherTripId = (await prisma.trip.create({ data: { userId, name: "Schweiz" } })).id;
    const created = await request(app)
      .post(api("/roadtrips"))
      .set("Cookie", cookie)
      .send({ name: "Südnorwegen", tripId });
    roadtripId = created.body.roadtrip.id;
    const saved = await request(app)
      .put(api(`/roadtrips/${roadtripId}/stations`))
      .set("Cookie", cookie)
      .send({
        stations: [
          { title: "Hirtshals", lat: 57.59, lon: 9.96, night: { kind: "pass" } },
          { title: "", lat: 58.5, lon: 8.5, night: { kind: "via" } },
          { title: "Kristiansand", lat: 58.15, lon: 8.0, night: { kind: "free" } },
          { title: "Stavanger", lat: 58.97, lon: 5.73, night: { kind: "free" } },
        ],
      });
    expect(saved.status).toBe(200);
    // The detail lists the via point too; the order is the travel order.
    const detail = await request(app)
      .get(api(`/roadtrips/${roadtripId}`))
      .set("Cookie", cookie);
    stationIds = detail.body.stations.map((s: { id: string }) => s.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  const post = (path: string, body: object, as = cookie) =>
    request(app).post(api(path)).set("Cookie", as).send(body);

  describe("on a trip", () => {
    it("records a trip-wide expense and lists it with totals per currency", async () => {
      const a = await post(`/trips/${tripId}/expenses`, {
        kind: "toll",
        amount: 40,
        currency: "CHF",
        date: "2026-07-01",
        note: "Vignette",
      });
      expect(a.status).toBe(201);
      expect(a.body.expense).toMatchObject({
        tripId,
        routeId: null,
        kind: "toll",
        amount: 40,
        currency: "CHF",
        date: "2026-07-01",
        note: "Vignette",
      });
      await post(`/trips/${tripId}/expenses`, { kind: "fuel", amount: 0.1, currency: "EUR" });
      await post(`/trips/${tripId}/expenses`, { kind: "fuel", amount: 0.2, currency: "EUR" });

      const list = await request(app)
        .get(api(`/trips/${tripId}/expenses`))
        .set("Cookie", cookie);
      expect(list.status).toBe(200);
      expect(list.body.totals).toEqual({ CHF: 40, EUR: 0.3 });
      // Dated first, undated after.
      expect(list.body.expenses.map((e: { kind: string }) => e.kind)).toEqual([
        "toll",
        "fuel",
        "fuel",
      ]);
    });

    it("lists the expenses of the trip's roadtrip with the trip's own", async () => {
      await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "ferry",
        amount: 1290,
        currency: "NOK",
      });
      await post(`/trips/${tripId}/expenses`, { kind: "toll", amount: 40, currency: "CHF" });

      const list = await request(app)
        .get(api(`/trips/${tripId}/expenses`))
        .set("Cookie", cookie);
      expect(list.body.totals).toEqual({ NOK: 1290, CHF: 40 });
    });

    it("puts an expense on a section of the trip when the body names routeId", async () => {
      const res = await post(`/trips/${tripId}/expenses`, {
        kind: "pitch",
        amount: 350,
        currency: "NOK",
        routeId: roadtripId,
        stopId: stationIds[2],
      });
      expect(res.status).toBe(201);
      expect(res.body.expense).toMatchObject({ tripId: null, routeId: roadtripId });
    });

    it("refuses a roadtrip station without routeId — it is not one of the trip's own stops", async () => {
      const res = await post(`/trips/${tripId}/expenses`, {
        kind: "pitch",
        amount: 350,
        currency: "NOK",
        stopId: stationIds[2],
      });
      expect(res.status).toBe(400);
    });

    it("refuses a routeId of a section on another trip", async () => {
      const res = await post(`/trips/${otherTripId}/expenses`, {
        kind: "pitch",
        amount: 1,
        currency: "NOK",
        routeId: roadtripId,
      });
      expect(res.status).toBe(404);
    });

    it("follows a roadtrip that moves to another trip", async () => {
      await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "ferry",
        amount: 1290,
        currency: "NOK",
      });
      const moved = await request(app)
        .patch(api(`/tours/${roadtripId}`))
        .set("Cookie", cookie)
        .send({ tripId: otherTripId });
      expect(moved.status).toBe(200);

      const left = await request(app)
        .get(api(`/trips/${tripId}/expenses`))
        .set("Cookie", cookie);
      const joined = await request(app)
        .get(api(`/trips/${otherTripId}/expenses`))
        .set("Cookie", cookie);
      expect(left.body.totals).toEqual({});
      expect(joined.body.totals).toEqual({ NOK: 1290 });
    });
  });

  describe("on a roadtrip", () => {
    it("pins one to a station and one to the way between two, and sums them in the detail", async () => {
      const pitch = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "pitch",
        amount: 350,
        currency: "NOK",
        stopId: stationIds[2],
        date: "2026-07-15",
      });
      expect(pitch.status).toBe(201);
      // Recorded up to the via point: reported on Hirtshals → Kristiansand.
      const toll = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "toll",
        amount: 12.5,
        currency: "EUR",
        legFromStopId: stationIds[0],
        legToStopId: stationIds[1],
      });
      expect(toll.status).toBe(201);
      await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "other",
        amount: 5,
        currency: "EUR",
      });

      const detail = await request(app)
        .get(api(`/roadtrips/${roadtripId}`))
        .set("Cookie", cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.expenses).toHaveLength(3);
      expect(detail.body.costs).toEqual({
        total: { NOK: 350, EUR: 17.5 },
        byStation: [{ stopId: stationIds[2], byCurrency: { NOK: 350 } }],
        byLeg: [{ fromStopId: stationIds[0], toStopId: stationIds[2], byCurrency: { EUR: 12.5 } }],
        unpinned: { EUR: 5 },
      });
    });

    it("refuses an expense pinned to a route correction", async () => {
      const res = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "fuel",
        amount: 60,
        currency: "NOK",
        stopId: stationIds[1],
      });
      expect(res.status).toBe(400);
    });

    it("refuses a station and a leg at once, half a leg, and a stop of the trip's timeline", async () => {
      const both = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "toll",
        amount: 1,
        currency: "NOK",
        stopId: stationIds[0],
        legFromStopId: stationIds[0],
        legToStopId: stationIds[2],
      });
      const half = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "toll",
        amount: 1,
        currency: "NOK",
        legFromStopId: stationIds[0],
      });
      const timelineStop = await prisma.tripStop.create({
        data: { tripId, title: "Oslo", lat: 59.91, lon: 10.75 },
      });
      const foreign = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "toll",
        amount: 1,
        currency: "NOK",
        stopId: timelineStop.id,
      });
      expect([both.status, half.status, foreign.status]).toEqual([400, 400, 400]);
    });

    it("refuses an unknown currency, a negative amount and a day that does not exist", async () => {
      const bodies = [
        { kind: "fuel", amount: 1, currency: "XYZ" },
        { kind: "fuel", amount: -1, currency: "EUR" },
        { kind: "fuel", amount: 1, currency: "EUR", date: "2026-02-30" },
        { kind: "bribe", amount: 1, currency: "EUR" },
      ];
      for (const body of bodies) {
        expect((await post(`/roadtrips/${roadtripId}/expenses`, body)).status).toBe(400);
      }
      expect(await prisma.tripExpense.count({ where: { routeId: roadtripId } })).toBe(0);
    });

    it("keeps the money when its station is deleted, as unpinned", async () => {
      await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "pitch",
        amount: 350,
        currency: "NOK",
        stopId: stationIds[3],
      });
      const remaining = await request(app)
        .put(api(`/roadtrips/${roadtripId}/stations`))
        .set("Cookie", cookie)
        .send({
          stations: [
            {
              id: stationIds[0],
              title: "Hirtshals",
              lat: 57.59,
              lon: 9.96,
              night: { kind: "pass" },
            },
            {
              id: stationIds[2],
              title: "Kristiansand",
              lat: 58.15,
              lon: 8.0,
              night: { kind: "free" },
            },
          ],
        });
      expect(remaining.status).toBe(200);
      const detail = await request(app)
        .get(api(`/roadtrips/${roadtripId}`))
        .set("Cookie", cookie);
      expect(detail.body.costs.total).toEqual({ NOK: 350 });
      expect(detail.body.costs.unpinned).toEqual({ NOK: 350 });
    });

    it("answers 404 for a tour id on the roadtrip path, and serves it on the tour path", async () => {
      const tour = await prisma.tripRoute.create({
        data: { userId, name: "Preikestolen", mode: "foot", kind: "tour" },
      });
      const viaRoadtrip = await post(`/roadtrips/${tour.id}/expenses`, {
        kind: "parking",
        amount: 250,
        currency: "NOK",
      });
      const viaTour = await post(`/tours/${tour.id}/expenses`, {
        kind: "parking",
        amount: 250,
        currency: "NOK",
      });
      expect(viaRoadtrip.status).toBe(404);
      expect(viaTour.status).toBe(201);
    });
  });

  describe("PATCH and DELETE", () => {
    it("changes only what the body names, and clears what it sends as null", async () => {
      const created = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "fuel",
        amount: 80,
        currency: "EUR",
        date: "2026-07-14",
        note: "Diesel",
        stopId: stationIds[2],
      });
      const id = created.body.expense.id;
      const res = await request(app)
        .patch(api(`/roadtrips/${roadtripId}/expenses/${id}`))
        .set("Cookie", cookie)
        .send({ amount: 82.4, note: null });
      expect(res.status).toBe(200);
      expect(res.body.expense).toMatchObject({
        amount: 82.4,
        note: null,
        currency: "EUR",
        date: "2026-07-14",
        stopId: stationIds[2],
      });
    });

    it("refuses a PATCH that would put a leg beside a pinned station", async () => {
      const created = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "fuel",
        amount: 80,
        currency: "EUR",
        stopId: stationIds[2],
      });
      const res = await request(app)
        .patch(api(`/roadtrips/${roadtripId}/expenses/${created.body.expense.id}`))
        .set("Cookie", cookie)
        .send({ legFromStopId: stationIds[0], legToStopId: stationIds[2] });
      expect(res.status).toBe(400);
    });

    it("deletes one", async () => {
      const created = await post(`/trips/${tripId}/expenses`, {
        kind: "toll",
        amount: 40,
        currency: "CHF",
      });
      const del = await request(app)
        .delete(api(`/trips/${tripId}/expenses/${created.body.expense.id}`))
        .set("Cookie", cookie);
      expect(del.status).toBe(204);
      expect(await prisma.tripExpense.count({ where: { tripId } })).toBe(0);
    });
  });

  describe("ownership", () => {
    it("never lets another account read, add, change or delete", async () => {
      const mine = await post(`/trips/${tripId}/expenses`, {
        kind: "toll",
        amount: 40,
        currency: "CHF",
      });
      const id = mine.body.expense.id;

      const read = await request(app)
        .get(api(`/trips/${tripId}/expenses`))
        .set("Cookie", otherCookie);
      const add = await post(
        `/roadtrips/${roadtripId}/expenses`,
        { kind: "toll", amount: 1, currency: "CHF" },
        otherCookie
      );
      const change = await request(app)
        .patch(api(`/trips/${tripId}/expenses/${id}`))
        .set("Cookie", otherCookie)
        .send({ amount: 0 });
      const remove = await request(app)
        .delete(api(`/trips/${tripId}/expenses/${id}`))
        .set("Cookie", otherCookie);
      expect([read.status, add.status, change.status, remove.status]).toEqual([404, 404, 404, 404]);
      expect(
        (await prisma.tripExpense.findUniqueOrThrow({ where: { id } })).amount.toNumber()
      ).toBe(40);
    });

    it("does not reach an expense of another trip of mine through this trip's path", async () => {
      const elsewhere = await post(`/trips/${otherTripId}/expenses`, {
        kind: "toll",
        amount: 40,
        currency: "CHF",
      });
      const res = await request(app)
        .delete(api(`/trips/${tripId}/expenses/${elsewhere.body.expense.id}`))
        .set("Cookie", cookie);
      expect(res.status).toBe(404);
    });

    it("refuses a stranger's station as a pin", async () => {
      const theirs = await prisma.tripRoute.create({
        data: { userId: otherId, name: "Fremd", mode: "road", kind: "roadtrip" },
      });
      const stop = await prisma.tripStop.create({
        data: { title: "Fremd", lat: 1, lon: 1, routeId: theirs.id, routeOrderIdx: 0 },
      });
      const res = await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "fuel",
        amount: 1,
        currency: "EUR",
        stopId: stop.id,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("in the statistics", () => {
    // A section's expense lives on its roadtrip page, behind the roadtrip
    // gate, and the statistics read the trips page's own gate (forgejo#274
    // review I1) — so the case shows roadtrips, as the app would.
    let betaBefore: boolean;
    beforeAll(async () => {
      betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
      await updateInstanceSettings({ betaFeaturesEnabled: true });
      await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, enabledDomains: ["flight", "roadtrip"], data: {} },
        update: { enabledDomains: ["flight", "roadtrip"] },
      });
    });
    afterAll(async () => {
      await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
      await prisma.userSettings.deleteMany({ where: { userId } });
    });

    it("counts per year and per trip, per currency, never summed across them", async () => {
      await post(`/roadtrips/${roadtripId}/expenses`, {
        kind: "ferry",
        amount: 1290,
        currency: "NOK",
        date: "2026-07-14",
      });
      await post(`/trips/${tripId}/expenses`, {
        kind: "toll",
        amount: 40,
        currency: "CHF",
        date: "2025-12-31",
      });
      await post(`/trips/${tripId}/expenses`, { kind: "fuel", amount: 20, currency: "EUR" });

      const res = await request(app).get(api("/stats/travel-account")).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.expenses).toEqual({
        count: 3,
        totalByCurrency: { NOK: 1290, CHF: 40, EUR: 20 },
        years: [
          { year: "2025", count: 1, byCurrency: { CHF: 40 } },
          { year: "2026", count: 1, byCurrency: { NOK: 1290 } },
        ],
        undatedByCurrency: { EUR: 20 },
      });
      const row = res.body.trips.trips.find((t: { id: string }) => t.id === tripId);
      expect(row.spendByCurrency).toEqual({ NOK: 1290, CHF: 40, EUR: 20 });
    });
  });
});
