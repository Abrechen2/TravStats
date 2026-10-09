import request from "supertest";

import app from "../../index";
import { observeQueries, prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#217 — trip, tags and companions over an explicit selection. One
 * result per flight; a retry with the failed ids changes nothing twice.
 */
describe("POST /flights/bulk-edit", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const send = (body: unknown) =>
    request(app)
      .post("/api/v1/flights/bulk-edit")
      .set("Cookie", cookie)
      .send(body as object);

  const flight = (owner: string, over: Record<string, unknown> = {}) =>
    prisma.flight.create({
      data: {
        userId: owner,
        flightNumber: "LH1",
        depIata: "MUC",
        arrIata: "FRA",
        depLat: 48.35,
        depLon: 11.79,
        arrLat: 50.03,
        arrLon: 8.56,
        departureTime: new Date("2026-11-02T06:00:00Z"),
        arrivalTime: new Date("2026-11-02T07:05:00Z"),
        status: "scheduled",
        dataSource: "manual",
        ...over,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["flbulk", "flbulkother"] } } });
    const u = await prisma.user.create({
      data: { username: "flbulk", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "flbulkother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("adds tags, replaces companions and sets the trip, per flight", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Herbst" } });
    const a = await flight(userId, { tags: ["work"], companions: ["Bo"] });
    const b = await flight(userId, { tags: [] });
    const res = await send({
      flightIds: [a.id, b.id],
      trip: { mode: "set", tripId: trip.id },
      tags: { mode: "add", values: ["autumn", "work"] },
      companions: { mode: "replace", values: ["Anna"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ updated: 2, unchanged: 0, failed: 0 });
    expect(res.body.success).toBeUndefined();

    const rows = await prisma.flight.findMany({
      where: { id: { in: [a.id, b.id] } },
      include: { companionLinks: { include: { companion: true } } },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.tags)).toEqual([
      ["work", "autumn"],
      ["autumn", "work"],
    ]);
    expect(rows.map((r) => r.tripId)).toEqual([trip.id, trip.id]);
    expect(rows.map((r) => r.companions)).toEqual([["Anna"], ["Anna"]]);
    // The display array and the links agree, as the single-flight PUT keeps them.
    expect(rows.map((r) => r.companionLinks.map((l) => l.companion.displayName))).toEqual([
      ["Anna"],
      ["Anna"],
    ]);
  });

  it("names a flight that is not the caller's as failed and still edits the others", async () => {
    const own = await flight(userId);
    const foreign = await flight(otherUserId);
    const res = await send({
      flightIds: [own.id, foreign.id],
      tags: { mode: "add", values: ["x"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { flightId: own.id, status: "updated" },
      { flightId: foreign.id, status: "failed", code: "FLIGHT_NOT_FOUND" },
    ]);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: foreign.id } })).tags).toEqual([]);
  });

  it("reports a database refusal for one flight, keeps the rest, and a retry of that one lands", async () => {
    const a = await flight(userId);
    const b = await flight(userId);
    const spy = jest
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(() => Promise.reject(new Error("connection reset")));
    const body = { tags: { mode: "add", values: ["x"] } };
    const first = await send({ ...body, flightIds: [a.id, b.id] });
    spy.mockRestore();
    expect(first.body.results).toEqual([
      { flightId: a.id, status: "failed", code: "UPDATE_FAILED" },
      { flightId: b.id, status: "updated" },
    ]);
    const retry = await send({ ...body, flightIds: [a.id] });
    expect(retry.body.results).toEqual([{ flightId: a.id, status: "updated" }]);
    const tags = await prisma.flight.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { tags: true },
    });
    expect(tags).toEqual([{ tags: ["x"] }, { tags: ["x"] }]);
  });

  it("is idempotent: the same edit again changes nothing and says so", async () => {
    const a = await flight(userId, { companions: ["Bo"] });
    const body = {
      flightIds: [a.id],
      tags: { mode: "add", values: ["x"] },
      companions: { mode: "add", values: ["Anna"] },
    };
    expect((await send(body)).body.summary.updated).toBe(1);
    const again = await send(body);
    expect(again.body.results).toEqual([{ flightId: a.id, status: "unchanged" }]);
    const row = await prisma.flight.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.tags).toEqual(["x"]);
    expect(row.companions).toEqual(["Bo", "Anna"]);
  });

  it("clears the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Alt" } });
    const a = await flight(userId, { tripId: trip.id });
    const res = await send({ flightIds: [a.id], trip: { mode: "clear" } });
    expect(res.body.summary.updated).toBe(1);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: a.id } })).tripId).toBeNull();
  });

  it("refuses another user's trip before writing anything", async () => {
    const foreignTrip = await prisma.trip.create({ data: { userId: otherUserId, name: "Fremd" } });
    const a = await flight(userId);
    const res = await send({
      flightIds: [a.id],
      trip: { mode: "set", tripId: foreignTrip.id },
      tags: { mode: "add", values: ["x"] },
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("TRIP_NOT_FOUND");
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: a.id } })).tags).toEqual([]);
  });

  it("refuses an empty edit and a repeated id", async () => {
    const a = await flight(userId);
    expect((await send({ flightIds: [a.id] })).status).toBe(400);
    expect(
      (await send({ flightIds: [a.id, a.id], tags: { mode: "add", values: ["x"] } })).status
    ).toBe(400);
  });

  describe("at scale (review I2)", () => {
    async function manyFlights(n: number, companions: string[] = []): Promise<string[]> {
      await prisma.flight.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          userId,
          flightNumber: `LH${i}`,
          depIata: "MUC",
          arrIata: "FRA",
          depLat: 48.35,
          depLon: 11.79,
          arrLat: 50.03,
          arrLon: 8.56,
          departureTime: new Date(Date.UTC(2026, 0, 1, 0, i)),
          arrivalTime: new Date(Date.UTC(2026, 0, 1, 2, i)),
          status: "flown",
          dataSource: "manual",
          companions,
        })),
      });
      const rows = await prisma.flight.findMany({ where: { userId }, select: { id: true } });
      return rows.map((r) => r.id);
    }

    async function countQueries(run: () => Promise<unknown>): Promise<number> {
      let n = 0;
      const stop = observeQueries(() => {
        n += 1;
      });
      try {
        await run();
      } finally {
        stop();
      }
      return n;
    }

    it("edits 200 flights with two reads plus the changed flights' writes, and a repeat writes nothing", async () => {
      const ids = await manyFlights(200, ["Bo", "Cleo", "Dan"]);
      const body = {
        flightIds: ids,
        tags: { mode: "add", values: ["x"] },
        companions: { mode: "add", values: ["Anna"] },
      };
      let first: request.Response | undefined;
      const firstQueries = await countQueries(async () => {
        first = await send(body);
      });
      expect(first?.status).toBe(200);
      expect(first?.body.summary).toEqual({ updated: 200, unchanged: 0, failed: 0 });
      // Per changed flight: delete links, create links, update — never a
      // per-name upsert. Plus the flights read, the people read, the one
      // create of the people nobody had yet, and the auth lookups.
      expect(firstQueries).toBeLessThanOrEqual(200 * 3 + 20);

      let again: request.Response | undefined;
      const repeatQueries = await countQueries(async () => {
        again = await send(body);
      });
      expect(again?.body.summary).toEqual({ updated: 0, unchanged: 200, failed: 0 });
      expect(repeatQueries).toBeLessThanOrEqual(8);
    });

    it("refuses more than 200 ids", async () => {
      const ids = Array.from(
        { length: 201 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      );
      const res = await send({ flightIds: ids, tags: { mode: "add", values: ["x"] } });
      expect(res.status).toBe(400);
    });

    it("never renames a person to the spelling another flight stored", async () => {
      await prisma.companion.create({
        data: { userId, canonicalName: "anna", displayName: "Anna", searchName: "anna" },
      });
      const b = await flight(userId, { companions: ["Anna"] });
      const a = await flight(userId, { companions: ["anna"] });
      // The lower-case spelling last in the selection — the order that used
      // to make it the person's display name.
      await send({ flightIds: [b.id, a.id], companions: { mode: "add", values: ["Bo"] } });
      const anna = await prisma.companion.findFirstOrThrow({
        where: { userId, canonicalName: "anna" },
      });
      expect(anna.displayName).toBe("Anna");
      expect((await prisma.flight.findUniqueOrThrow({ where: { id: a.id } })).companions).toEqual([
        "anna",
        "Bo",
      ]);
    });
  });
});
