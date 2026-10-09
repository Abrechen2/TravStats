/**
 * forgejo#223: the "all aboard" time of a port call is a field of its own,
 * entered by the user from the ship's daily programme — stored as typed,
 * returned with the stop, never filled from the departure, and refused when it
 * is not a clock.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USER = "cruiseallaboard";

describe("a port call's all-aboard time", () => {
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const create = (stops: unknown[]) =>
    request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Testreederei", startDate: "2026-07-01", stops });

  it("stores what the user typed and returns it with the stop", async () => {
    const res = await create([
      {
        dayNumber: 2,
        isAtSea: false,
        unresolvedPortName: "Hafen ohne Katalog",
        departureTime: { local: "2026-07-02T18:00" },
        allAboardTime: "17:30",
      },
      { dayNumber: 3, isAtSea: true },
    ]);
    expect(res.status).toBe(201);
    const stops = res.body.data.stops as Array<{ dayNumber: number; allAboardTime: unknown }>;
    expect(stops.find((s) => s.dayNumber === 2)?.allAboardTime).toBe("17:30");
    // A sea day has none.
    expect(stops.find((s) => s.dayNumber === 3)?.allAboardTime).toBeNull();
  });

  it("is not made up from the departure when none was entered", async () => {
    const res = await create([
      {
        dayNumber: 1,
        isAtSea: false,
        unresolvedPortName: "Hafen ohne Katalog",
        departureTime: { local: "2026-07-01T18:00" },
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.stops[0].allAboardTime).toBeNull();
  });

  it("survives a PATCH that resends it, and an empty value clears it", async () => {
    const created = await create([
      { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "16:45" },
    ]);
    const id = created.body.data.id as string;

    const kept = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({
        stops: [
          { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "16:45" },
        ],
      });
    expect(kept.status).toBe(200);
    expect(kept.body.data.stops[0].allAboardTime).toBe("16:45");

    const cleared = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({
        stops: [{ dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "" }],
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.stops[0].allAboardTime).toBeNull();
  });

  it.each(["25:00", "17:3", "5pm", "17:30:00"])("refuses %s", async (value) => {
    const res = await create([
      { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: value },
    ]);
    expect(res.status).toBe(400);
  });

  /**
   * Review C1: a client that does not know the field — the Companion's route
   * editor rebuilds every stop without it — must not erase it. An ABSENT key
   * keeps the matched stored stop's value; matching never goes by day alone.
   */
  describe("a PATCH that does not send the key", () => {
    const at = (name: string, day: number, extra: Record<string, unknown> = {}) => ({
      dayNumber: day,
      isAtSea: false,
      unresolvedPortName: name,
      ...extra,
    });
    const patch = (id: string, stops: unknown[]) =>
      request(app).patch(`/api/v1/cruises/${id}`).set("Cookie", cookie).send({ stops });
    const times = (res: request.Response): Record<string, unknown> =>
      Object.fromEntries(
        (res.body.data.stops as Array<{ dayNumber: number; allAboardTime: unknown }>).map((s) => [
          s.dayNumber,
          s.allAboardTime,
        ])
      );

    async function cruiseWith(stops: unknown[]): Promise<string> {
      const res = await create(stops);
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    }

    it("keeps the stored time for the same stops", async () => {
      const id = await cruiseWith([at("Oslo", 3, { allAboardTime: "17:30" })]);
      const res = await patch(id, [at("Oslo", 3)]);
      expect(res.status).toBe(200);
      expect(times(res)).toEqual({ 3: "17:30" });
    });

    it("keeps it when a reorder renumbered the day", async () => {
      const id = await cruiseWith([
        at("Oslo", 3, { allAboardTime: "17:30" }),
        at("Bergen", 4, { allAboardTime: "16:45" }),
      ]);
      const res = await patch(id, [at("Bergen", 3), at("Oslo", 4)]);
      expect(times(res)).toEqual({ 3: "16:45", 4: "17:30" });
    });

    it("does not give a swapped port the old port's time", async () => {
      const id = await cruiseWith([at("Bergen", 4, { allAboardTime: "16:45" })]);
      const res = await patch(id, [at("Stavanger", 4)]);
      expect(times(res)).toEqual({ 4: null });
    });

    it("still clears it on an explicit null", async () => {
      const id = await cruiseWith([at("Oslo", 3, { allAboardTime: "17:30" })]);
      const res = await patch(id, [at("Oslo", 3, { allAboardTime: null })]);
      expect(times(res)).toEqual({ 3: null });
    });

    it("never puts one on a day that became a sea day", async () => {
      const id = await cruiseWith([at("Oslo", 3, { allAboardTime: "17:30" })]);
      const res = await patch(id, [{ dayNumber: 3, isAtSea: true }]);
      expect(times(res)).toEqual({ 3: null });
    });

    it("keeps both times of a round trip calling at one port twice, by day", async () => {
      const id = await cruiseWith([
        at("Kiel", 1, { allAboardTime: "16:00" }),
        at("Kiel", 8, { allAboardTime: "07:30" }),
      ]);
      const res = await patch(id, [at("Kiel", 1), at("Kiel", 8)]);
      expect(times(res)).toEqual({ 1: "16:00", 8: "07:30" });
    });

    it("follows a stop by its id when the client sends one", async () => {
      const created = await create([at("Oslo", 3, { allAboardTime: "17:30" })]);
      const stopId = created.body.data.stops[0].id as string;
      // Renamed and moved: only the id still says it is the same call.
      const res = await patch(created.body.data.id as string, [at("Oslo Havn", 5, { id: stopId })]);
      expect(times(res)).toEqual({ 5: "17:30" });
    });
  });
});
