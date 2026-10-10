import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter, railCreationLimiter } from "../../middleware/rateLimit";
import { dbLogger } from "../../utils/logger";
import {
  CLIENT_REF_RETENTION_DAYS,
  payloadHash,
  pruneClientRefs,
} from "../../services/sync/clientRef";

/**
 * Exactly-once creates (forgejo#283): the Companion's outbox repeats a POST
 * whose answer it lost, carrying the `clientRef` it minted. A repeat answers
 * the first row (200, same id, same body) and creates nothing — also when the
 * two arrive at once. The key is the account's, across every route.
 */

const FRANKFURT = { name: "Frankfurt (Main) Hbf", lat: 50.1071, lon: 8.6632, country: "DE" };
const PARIS = { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" };
const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };

const rail = {
  operator: "DB Fernverkehr",
  trainCategory: "ICE",
  trainNumber: "9557",
  departureStation: FRANKFURT,
  arrivalStation: PARIS,
  departureLocal: "2026-07-01T08:15",
  arrivalLocal: "2026-07-01T12:09",
};
const bus = {
  operator: "Kobus",
  departureStation: SEOUL,
  arrivalStation: SOKCHO,
  departureLocal: "2026-09-20T09:00",
  arrivalLocal: "2026-09-20T11:20",
};
const expense = { kind: "ferry", amount: 1290, currency: "NOK", date: "2026-07-16" };

const ref = (n: number) => `5f0c7c1e-8a1b-4d55-9d7e-2b1f4f0e9c${String(n).padStart(2, "0")}`;

describe("clientRef — create at most once", () => {
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let roadtripId: string;

  const post = (path: string, body: object, as = cookie) =>
    request(app).post(`/api/v1${path}`).set("Cookie", as).send(body);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["clientref_a", "clientref_b"] } } });
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: "clientref_a", passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: "clientref_b", passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Norwegen" } })).id;
    const roadtrip = await post("/roadtrips", { name: "Südnorwegen", tripId });
    expect(roadtrip.status).toBe(201);
    roadtripId = roadtrip.body.roadtrip.id;
  });

  afterEach(async () => {
    const users = { in: [userId, otherId] };
    await prisma.clientWriteRef.deleteMany({ where: { userId: users } });
    await prisma.railJourney.deleteMany({ where: { userId: users } });
    await prisma.busJourney.deleteMany({ where: { userId: users } });
    await prisma.tripExpense.deleteMany({ where: { userId: users } });
    await prisma.tripRoute.deleteMany({ where: { userId: users, kind: "tour" } });
    for (const id of [userId, otherId]) {
      await railCreationLimiter.resetKey(`user:${id}`);
      await busCreationLimiter.resetKey(`user:${id}`);
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("answers a repeated rail POST with the first journey, 200, same body shape", async () => {
    const first = await post("/rail", { ...rail, clientRef: ref(1) });
    expect(first.status).toBe(201);
    const again = await post("/rail", { ...rail, clientRef: ref(1) });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.data).toEqual(first.body.data);
    // The line was resolved by the first request; the repeat looked nothing up.
    expect(again.body.meta.geometry).toEqual({
      outcome: "unchanged",
      geometrySource: first.body.data.geometrySource,
      fallback: null,
    });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("still creates two identical rides that carry two keys — or none", async () => {
    await post("/rail", { ...rail, clientRef: ref(2) }).expect(201);
    await post("/rail", { ...rail, clientRef: ref(3) }).expect(201);
    await post("/rail", rail).expect(201);
    await post("/rail", rail).expect(201);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(4);
  });

  it("answers a repeated bus POST with the first ride", async () => {
    const first = await post("/bus", { ...bus, clientRef: ref(4) });
    expect(first.status).toBe(201);
    const again = await post("/bus", { ...bus, clientRef: ref(4) });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(1);
  });

  it("makes ONE row from two concurrent POSTs with one key", async () => {
    const [a, b] = await Promise.all([
      post("/bus", { ...bus, clientRef: ref(5) }),
      post("/bus", { ...bus, clientRef: ref(5) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(1);
    expect(await prisma.clientWriteRef.count({ where: { userId } })).toBe(1);
  });

  it("answers a repeated tour POST with the first tour, also when both arrive at once", async () => {
    const tour = { name: "Lauf 07:12", mode: "foot", activity: "run", clientRef: ref(12) };
    const error = jest.spyOn(dbLogger, "error");
    try {
      const [a, b] = await Promise.all([post("/tours", tour), post("/tours", tour)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body).toEqual(b.body);
      // The lost race is handled, so it is no database error in the log.
      const logged = error.mock.calls.filter(
        ([entry]) => (entry as { operation?: string }).operation === "database_query_error"
      );
      expect(logged).toHaveLength(0);
    } finally {
      error.mockRestore();
    }
    const again = await post("/tours", tour);
    expect(again.status).toBe(200);
    expect(await prisma.tripRoute.count({ where: { userId, kind: "tour" } })).toBe(1);
    // A second workout with the same name is a second tour under its own key.
    await post("/tours", { ...tour, clientRef: ref(13) }).expect(201);
    expect(await prisma.tripRoute.count({ where: { userId, kind: "tour" } })).toBe(2);
  });

  it("dedupes expenses on a trip and on a roadtrip", async () => {
    for (const path of [`/trips/${tripId}/expenses`, `/roadtrips/${roadtripId}/expenses`]) {
      const key = path.startsWith("/trips") ? ref(6) : ref(7);
      const first = await post(path, { ...expense, clientRef: key });
      expect(first.status).toBe(201);
      const again = await post(path, { ...expense, clientRef: key });
      expect(again.status).toBe(200);
      expect(again.body.expense).toEqual(first.body.expense);
      // A repeat looks no rate up: the stored one stands (forgejo#150).
      expect(again.body.fxSnapshot).toBe("unchanged");
    }
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(2);
  });

  describe("an expense's receipts and its key (forgejo#150 + #283)", () => {
    const receipt = () =>
      prisma.document.create({
        data: {
          userId,
          storedName: `${Math.random()}.pdf`,
          mimetype: "application/pdf",
          sizeBytes: 1,
          sha256: "0".repeat(64),
          format: "pdf",
        },
      });

    afterEach(async () => {
      await prisma.document.deleteMany({ where: { userId } });
    });

    it("files the receipts once: a repeat answers the expense and links nothing again", async () => {
      const doc = await receipt();
      const body = { ...expense, date: null, documentIds: [doc.id], clientRef: ref(20) };
      const first = await post(`/trips/${tripId}/expenses`, body);
      expect(first.status).toBe(201);
      expect(first.body.expense.documentCount).toBe(1);
      const linkedAt = (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } }))
        .linkedAt;

      const again = await post(`/trips/${tripId}/expenses`, body);
      expect(again.status).toBe(200);
      expect(again.body.expense).toEqual(first.body.expense);
      expect(again.body.fxSnapshot).toBe("unchanged");
      const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect(after.tripExpenseId).toBe(first.body.expense.id);
      expect(after.linkedAt).toEqual(linkedAt);
      expect(await prisma.tripExpense.count({ where: { userId } })).toBe(1);
    });

    it("refuses a repeat that names other receipts: 409, nothing created or filed", async () => {
      const [a, b] = [await receipt(), await receipt()];
      const base = { ...expense, date: null, clientRef: ref(21) };
      expect(
        (await post(`/trips/${tripId}/expenses`, { ...base, documentIds: [a.id] })).status
      ).toBe(201);
      const other = await post(`/trips/${tripId}/expenses`, { ...base, documentIds: [b.id] });
      expect(other.status).toBe(409);
      expect(other.body.code).toBe("CLIENT_REF_REUSED");
      expect(
        (await prisma.document.findUniqueOrThrow({ where: { id: b.id } })).tripExpenseId
      ).toBeNull();
      expect(await prisma.tripExpense.count({ where: { userId } })).toBe(1);
    });

    it("leaves no expense and no key when the receipt cannot be filed inside the write", async () => {
      const doc = await receipt();
      // Filed elsewhere between the check and the write: the count no longer matches.
      const original = prisma.$transaction.bind(prisma) as (fn: unknown) => Promise<unknown>;
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce((async (
        fn: unknown
      ) => {
        await prisma.document.update({ where: { id: doc.id }, data: { tripId } });
        return original(fn);
      }) as never);
      const res = await post(`/trips/${tripId}/expenses`, {
        ...expense,
        date: null,
        documentIds: [doc.id],
        clientRef: ref(22),
      });
      spy.mockRestore();
      expect(res.status).toBe(409);
      expect(await prisma.tripExpense.count({ where: { userId } })).toBe(0);
      expect(await prisma.clientWriteRef.count({ where: { userId } })).toBe(0);
    });
  });

  it("refuses the key with a different body — 409 naming the row it made — and creates nothing", async () => {
    const first = await post(`/trips/${tripId}/expenses`, { ...expense, clientRef: ref(8) });
    const changed = await post(`/trips/${tripId}/expenses`, {
      ...expense,
      amount: 1490,
      clientRef: ref(8),
    });
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({
      code: "CLIENT_REF_REUSED",
      field: "clientRef",
      kind: "expense",
      entityId: first.body.expense.id,
    });
    // Another route under the same key is no repeat either.
    const elsewhere = await post("/bus", { ...bus, clientRef: ref(8) });
    expect(elsewhere.status).toBe(409);
    expect(await prisma.tripExpense.count({ where: { userId } })).toBe(1);
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(0);
  });

  it("does not resurrect a row deleted since: 410", async () => {
    const first = await post("/bus", { ...bus, clientRef: ref(9) });
    await request(app)
      .delete(`/api/v1/bus/${first.body.data.id}`)
      .set("Cookie", cookie)
      .expect(204);
    const again = await post("/bus", { ...bus, clientRef: ref(9) });
    expect(again.status).toBe(410);
    expect(again.body).toMatchObject({
      code: "CLIENT_REF_TARGET_GONE",
      entityId: first.body.data.id,
    });
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(0);
  });

  it("keeps keys apart per account", async () => {
    const mine = await post("/bus", { ...bus, clientRef: ref(10) });
    const theirs = await post("/bus", { ...bus, clientRef: ref(10) }, otherCookie);
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    expect(theirs.body.data.id).not.toBe(mine.body.data.id);
  });

  it("400s a malformed key instead of ignoring it", async () => {
    for (const clientRef of ["", "x".repeat(65), "has space", 42]) {
      const res = await post("/rail", { ...rail, clientRef });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: "clientRef" });
    }
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("keeps no key for a create that was refused, so the corrected body can go", async () => {
    const refused = await post("/bus", {
      ...bus,
      arrivalLocal: "2026-09-20T08:00",
      clientRef: ref(11),
    });
    expect(refused.status).toBe(400);
    await post("/bus", { ...bus, clientRef: ref(11) }).expect(201);
  });

  it("prunes keys past the horizon and keeps the younger ones", async () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    await prisma.clientWriteRef.createMany({
      data: [
        { userId, clientRef: "old", kind: "bus", entityId: "x", payloadHash: "0".repeat(64) },
        { userId, clientRef: "young", kind: "bus", entityId: "y", payloadHash: "0".repeat(64) },
      ],
    });
    await prisma.clientWriteRef.update({
      where: { userId_clientRef: { userId, clientRef: "old" } },
      data: { createdAt: new Date(now.getTime() - (CLIENT_REF_RETENTION_DAYS + 1) * day) },
    });
    await prisma.clientWriteRef.update({
      where: { userId_clientRef: { userId, clientRef: "young" } },
      data: { createdAt: new Date(now.getTime() - (CLIENT_REF_RETENTION_DAYS - 1) * day) },
    });
    expect(await pruneClientRefs(now)).toBeGreaterThanOrEqual(1);
    const left = await prisma.clientWriteRef.findMany({ where: { userId } });
    expect(left.map((r) => r.clientRef)).toEqual(["young"]);
  });
});

describe("payloadHash", () => {
  it("does not count key order as a difference, but does count a value", () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      payloadHash({ b: { d: [1, 2], c: 2 }, a: 1 })
    );
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
    expect(payloadHash({ d: [1, 2] })).not.toBe(payloadHash({ d: [2, 1] }));
  });
});
