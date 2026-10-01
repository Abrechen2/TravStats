import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The leg PUT's `tollCost` / `currency` after the toll left the leg
 * (forgejo#140): older clients keep sending them, and they must land on the
 * leg's toll EXPENSE — the single source the totals now read — rather than
 * vanish into a column that no longer exists.
 */
describe("leg PUT — tollCost writes the leg's toll expense", () => {
  const USERNAME = `legtoll-${Date.now()}`;
  let cookie: string;
  let userId: string;
  let routeId: string;
  let fromId: string;
  let toId: string;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    const route = await prisma.tripRoute.create({
      data: { userId, name: "Ohne Reise", mode: "road", kind: "roadtrip" },
    });
    routeId = route.id;
    const res = await request(app)
      .put(`/api/v1/roadtrips/${routeId}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [
          {
            title: "Kristiansand",
            lat: 58.15,
            lon: 8.0,
            startDate: "2026-07-14",
            endDate: "2026-07-15",
            night: { kind: "free" },
          },
          { title: "Bergen", lat: 60.39, lon: 5.32, night: { kind: "pass" } },
        ],
      });
    expect(res.status).toBe(200);
    [fromId, toId] = res.body.stations.map((s: { id: string }) => s.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.$disconnect();
  });

  const url = () => `/api/v1/tours/${routeId}/legs/${fromId}/${toId}`;
  const tolls = () =>
    prisma.tripExpense.findMany({
      where: { routeId, kind: "toll" },
      orderBy: { createdAt: "asc" },
    });

  it("creates the toll expense, dated by the day the leg leaves its first station", async () => {
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: 12.5, currency: "eur" });

    expect(res.status).toBe(200);
    expect(res.body.toll).toMatchObject({
      kind: "toll",
      amount: 12.5,
      currency: "EUR",
      legFromStopId: fromId,
      legToStopId: toId,
      date: "2026-07-15",
      routeId,
      tripId: null,
    });
    expect(res.body.leg).not.toHaveProperty("tollCost");
    expect(await tolls()).toHaveLength(1);
  });

  it("updates the same expense on a second PUT instead of adding another", async () => {
    await request(app).put(url()).set("Cookie", cookie).send({ source: "straight", tollCost: 10 });
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: 14 });

    expect(res.status).toBe(200);
    const rows = await tolls();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount.toNumber()).toBe(14);
  });

  it("takes the owner's base currency when the old client sends none", async () => {
    await prisma.userSettings.create({ data: { userId, baseCurrency: "CHF", data: {} } });
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: 40 });
    expect(res.body.toll.currency).toBe("CHF");
  });

  it("deletes the toll expense when tollCost is null — the old 'clear the toll'", async () => {
    await request(app).put(url()).set("Cookie", cookie).send({ source: "straight", tollCost: 10 });
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: null });

    expect(res.status).toBe(200);
    expect(res.body.toll).toBeNull();
    expect(await tolls()).toEqual([]);
  });

  it("leaves the toll alone, and says nothing of it, when the body does not mention it", async () => {
    await request(app).put(url()).set("Cookie", cookie).send({ source: "straight", tollCost: 10 });
    const res = await request(app).put(url()).set("Cookie", cookie).send({ source: "straight" });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("toll");
    expect(await tolls()).toHaveLength(1);
  });

  it("refuses with 409, and changes neither the leg nor the tolls, when the leg has several", async () => {
    for (const amount of [5, 7]) {
      await prisma.tripExpense.create({
        data: {
          userId,
          routeId,
          kind: "toll",
          amount,
          currency: "NOK",
          legFromStopId: fromId,
          legToStopId: toId,
        },
      });
    }
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", mode: "ferry", tollCost: 99 });

    expect(res.status).toBe(409);
    const leg = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    expect(leg.mode).toBe("road");
    expect((await tolls()).map((t) => t.amount.toNumber())).toEqual([5, 7]);
  });

  it("refuses a currency that is not ISO 4217", async () => {
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", tollCost: 5, currency: "E1R" });
    expect(res.status).toBe(400);
    expect(await tolls()).toEqual([]);
  });
});
