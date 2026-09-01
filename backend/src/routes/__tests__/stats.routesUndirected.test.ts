import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * Forgejo #42, owner's decision 2026-08-31: a route is the PAIR, not the
 * direction.
 *
 * `/stats/routes` keyed `${dep}-${arr}`, so FRA→WAW and WAW→FRA were two routes
 * with one flight each while the Companion's globe grouped them as one with
 * two. Same account, two different route counts — the drift the issue was filed
 * about. A person says "I have flown Munich–Dubai eleven times" and means both
 * directions.
 *
 * This test exists because the change is invisible until someone flies home
 * again: a one-way account behaves identically under both rules.
 */
describe("GET /stats/routes groups a pair, not a direction", () => {
  let userId: string;
  let authCookie: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `routes-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(userId)}`;
  });

  afterEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function fly(dep: string, arr: string, depLat: number, arrLat: number): Promise<void> {
    await prisma.flight.create({
      data: {
        userId,
        status: "flown",
        depIata: dep,
        arrIata: arr,
        depLat,
        depLon: 10,
        arrLat,
        arrLon: 20,
        departureTime: new Date("2024-04-12T08:00:00Z"),
        arrivalTime: new Date("2024-04-12T10:00:00Z"),
      },
    });
  }

  it("counts the return leg as the same route", async () => {
    await fly("FRA", "WAW", 50.03, 52.17);
    await fly("WAW", "FRA", 52.17, 50.03);

    const res = await request(app).get("/api/v1/stats/routes").set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(res.body.routes[0].count).toBe(2);
  });

  it("still keeps genuinely different pairs apart", async () => {
    await fly("FRA", "WAW", 50.03, 52.17);
    await fly("FRA", "JFK", 50.03, 40.64);

    const res = await request(app).get("/api/v1/stats/routes").set("Cookie", authCookie);

    expect(res.body.routes).toHaveLength(2);
  });

  it("gives the pair one key whichever way it was flown first", async () => {
    await fly("WAW", "FRA", 52.17, 50.03);
    await fly("FRA", "WAW", 50.03, 52.17);

    const res = await request(app).get("/api/v1/stats/routes").set("Cookie", authCookie);

    // Sorted, so the key does not depend on which leg happened to be seen
    // first — otherwise two accounts with the same travel would disagree.
    expect(res.body.routes[0].route).toBe("FRA-WAW");
  });
});
