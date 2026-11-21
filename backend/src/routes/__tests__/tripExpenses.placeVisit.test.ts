import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import * as fx from "../../services/fx/resolver";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * An expense optionally names the place visit it was paid at (forgejo#429).
 * The expense stays on its trip: totals count it once, deleting the visit
 * keeps it, and a visit that is not the caller's (or not on the trip) is
 * refused. Currencies are never summed.
 */
describe("expenses at a place visit (forgejo#429)", () => {
  const OWNER = `exp-visit-${Date.now()}`;
  const STRANGER = `exp-visit-other-${Date.now()}`;
  let userId: string;
  let otherId: string;
  let cookie: string;
  let tripId: string;
  let otherTripId: string;
  let visitId: string;
  let otherTripVisitId: string;
  let foreignVisitId: string;

  const api = (path: string) => `/api/v1${path}`;
  const post = (body: object, trip = tripId) =>
    request(app)
      .post(api(`/trips/${trip}/expenses`))
      .set("Cookie", cookie)
      .send(body);

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: OWNER, passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: STRANGER, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.place.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    tripId = (await prisma.trip.create({ data: { userId, name: "Rom" } })).id;
    otherTripId = (await prisma.trip.create({ data: { userId, name: "Paris" } })).id;
    const place = await prisma.place.create({
      data: { userId, name: "Kolosseum", lat: 41.89, lon: 12.49 },
    });
    visitId = (await prisma.placeVisit.create({ data: { userId, placeId: place.id, tripId } })).id;
    otherTripVisitId = (
      await prisma.placeVisit.create({ data: { userId, placeId: place.id, tripId: otherTripId } })
    ).id;
    const foreignPlace = await prisma.place.create({
      data: { userId: otherId, name: "Louvre", lat: 48.86, lon: 2.33 },
    });
    foreignVisitId = (
      await prisma.placeVisit.create({ data: { userId: otherId, placeId: foreignPlace.id } })
    ).id;
  });
  afterEach(() => jest.restoreAllMocks());

  it("creates and edits an expense scoped to a visit, and clears the scope", async () => {
    const created = await post({
      kind: "other",
      amount: 18,
      currency: "EUR",
      placeVisitId: visitId,
    });
    expect(created.status).toBe(201);
    expect(created.body.expense.placeVisitId).toBe(visitId);
    const id = created.body.expense.id;

    const plain = await post({ kind: "other", amount: 2, currency: "EUR" });
    expect(plain.body.expense.placeVisitId).toBeNull();

    const scoped = await request(app)
      .patch(api(`/trips/${tripId}/expenses/${plain.body.expense.id}`))
      .set("Cookie", cookie)
      .send({ placeVisitId: visitId });
    expect(scoped.body.expense.placeVisitId).toBe(visitId);

    const untouched = await request(app)
      .patch(api(`/trips/${tripId}/expenses/${id}`))
      .set("Cookie", cookie)
      .send({ note: "Ticket" });
    expect(untouched.body.expense.placeVisitId).toBe(visitId);

    const cleared = await request(app)
      .patch(api(`/trips/${tripId}/expenses/${id}`))
      .set("Cookie", cookie)
      .send({ placeVisitId: null });
    expect(cleared.body.expense.placeVisitId).toBeNull();
  });

  it("refuses a foreign visit and a visit of another trip", async () => {
    const foreign = await post({
      kind: "other",
      amount: 1,
      currency: "EUR",
      placeVisitId: foreignVisitId,
    });
    expect(foreign.status).toBe(404);
    const elsewhere = await post({
      kind: "other",
      amount: 1,
      currency: "EUR",
      placeVisitId: otherTripVisitId,
    });
    expect(elsewhere.status).toBe(400);
    const plain = await post({ kind: "other", amount: 1, currency: "EUR" });
    const patched = await request(app)
      .patch(api(`/trips/${tripId}/expenses/${plain.body.expense.id}`))
      .set("Cookie", cookie)
      .send({ placeVisitId: foreignVisitId });
    expect(patched.status).toBe(404);
    expect(await prisma.tripExpense.count({ where: { placeVisitId: foreignVisitId } })).toBe(0);
  });

  it("keeps the expense on the trip when the visit is deleted", async () => {
    const created = await post({
      kind: "other",
      amount: 18,
      currency: "EUR",
      placeVisitId: visitId,
    });
    await prisma.placeVisit.delete({ where: { id: visitId } });
    const list = await request(app)
      .get(api(`/trips/${tripId}/expenses`))
      .set("Cookie", cookie);
    expect(list.body.expenses).toHaveLength(1);
    expect(list.body.expenses[0].id).toBe(created.body.expense.id);
    expect(list.body.expenses[0].placeVisitId).toBeNull();
    expect(list.body.totals).toEqual({ EUR: 18 });
  });

  it("counts a visit-scoped expense once in the trip total and keeps currencies apart", async () => {
    await post({ kind: "other", amount: 18, currency: "EUR", placeVisitId: visitId });
    await post({ kind: "other", amount: 100, currency: "NOK", placeVisitId: visitId });
    await post({ kind: "parking", amount: 5, currency: "EUR" });

    const trip = await request(app)
      .get(api(`/trips/${tripId}/expenses`))
      .set("Cookie", cookie);
    expect(trip.body.totals).toEqual({ EUR: 23, NOK: 100 });

    const atVisit = await request(app)
      .get(api(`/places/visits/${visitId}/expenses`))
      .set("Cookie", cookie);
    expect(atVisit.status).toBe(200);
    expect(atVisit.body.expenses).toHaveLength(2);
    expect(atVisit.body.totals).toEqual({ EUR: 18, NOK: 100 });

    const card = await request(app).get(api("/trips?includeInsights=true")).set("Cookie", cookie);
    const spend = card.body.trips.find((t: { id: string }) => t.id === tripId).cost.spendByCurrency;
    expect(spend).toEqual({ EUR: 23, NOK: 100 });

    const foreign = await request(app)
      .get(api(`/places/visits/${foreignVisitId}/expenses`))
      .set("Cookie", cookie);
    expect(foreign.status).toBe(404);
  });

  it("shows the expense's receipt on the visit's documents", async () => {
    const created = await post({
      kind: "other",
      amount: 18,
      currency: "EUR",
      placeVisitId: visitId,
    });
    const doc = await prisma.document.create({
      data: {
        userId,
        storedName: `x-${Date.now()}`,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: `${Date.now()}`,
        format: "pdf",
        links: {
          create: {
            tripExpenseId: created.body.expense.id,
            role: "primary",
            provenance: "user",
          },
        },
      },
    });
    const docs = await request(app)
      .get(api(`/places/visits/${visitId}/documents`))
      .set("Cookie", cookie);
    expect(docs.status).toBe(200);
    const ids = JSON.stringify(docs.body);
    expect(ids).toContain(doc.id);
    expect(ids).toContain("covers");
  });

  it("offers the trip's own visits as the scope, and nobody else's", async () => {
    const res = await request(app)
      .get(api(`/trips/${tripId}/place-visits`))
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.visits).toEqual([{ id: visitId, placeName: "Kolosseum" }]);
    const other = await request(app)
      .get(api(`/trips/${tripId}/place-visits`))
      .set("Cookie", `auth_token=${generateToken(otherId)}`);
    expect(other.status).toBe(404);
  });

  it("lets go of a visit's costs when the visit moves to another trip", async () => {
    const created = await post({
      kind: "other",
      amount: 5,
      currency: "EUR",
      placeVisitId: visitId,
    });
    const moved = await request(app)
      .patch(api(`/places/visits/${visitId}`))
      .set("Cookie", cookie)
      .send({ tripId: otherTripId });
    expect(moved.status).toBe(200);
    const row = await prisma.tripExpense.findUniqueOrThrow({
      where: { id: created.body.expense.id },
    });
    expect(row.placeVisitId).toBeNull();
    expect(row.tripId).toBe(tripId);
  });

  it("clears the visit link of a roadtrip's costs when the roadtrip moves to another trip", async () => {
    const route = await prisma.tripRoute.create({
      data: { userId, tripId, name: "Rundreise", mode: "road", kind: "roadtrip" },
    });
    const expense = await prisma.tripExpense.create({
      data: {
        userId,
        routeId: route.id,
        placeVisitId: visitId,
        kind: "other",
        amount: 7,
        currency: "EUR",
      },
    });
    const moved = await request(app)
      .patch(api(`/tours/${route.id}`))
      .set("Cookie", cookie)
      .send({ tripId: otherTripId });
    expect(moved.status).toBe(200);
    const row = await prisma.tripExpense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.placeVisitId).toBeNull();
    expect(row.routeId).toBe(route.id);
  });

  it("marks a receipt that reaches the visit only through an expense", async () => {
    const created = await post({
      kind: "other",
      amount: 18,
      currency: "EUR",
      placeVisitId: visitId,
    });
    await prisma.document.create({
      data: {
        userId,
        storedName: `y-${Date.now()}`,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: `y${Date.now()}`,
        format: "pdf",
        links: {
          create: { tripExpenseId: created.body.expense.id, role: "primary", provenance: "user" },
        },
      },
    });
    const docs = await request(app)
      .get(api(`/places/visits/${visitId}/documents`))
      .set("Cookie", cookie);
    expect(docs.body.data[0].viaExpense).toBe(true);
  });
});
