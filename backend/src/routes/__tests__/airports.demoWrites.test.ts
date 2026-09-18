import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Finding 7 of the cold security audit of 2026-09-19: `GET /airports/:code` was
 * unauthenticated AND writes. On a miss `findOrCreateAirport` calls an external
 * provider and inserts a row into the global catalogue that every account
 * reads — so any stranger could make this instance spend a lookup and then
 * store whatever came back, permanently, because `wipeDemoUser` never touches
 * a catalogue.
 *
 * `/search` beside it stays public on purpose: it only reads, and the
 * signup-flow autocomplete runs before anyone has credentials. The comment
 * above it in `routes/airports.ts` says so.
 *
 * The second half of this file records what the guard actually DOES, which is
 * not what its name suggests. `rejectDemoWrites` keys on the HTTP method, so a
 * GET passes — the shared demo account is NOT refused here, and the insert on
 * a miss is still reachable for it. The audit's own finding 8 calls that "a
 * future mutating GET would pass"; this route is that GET, today. Pinned
 * rather than assumed, so the next reader of the middleware list does not
 * mistake a mounted guard for a closed door.
 */
describe("GET /api/v1/airports/:code — authentication and the demo guard", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "airportCodeUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "airportCodeUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.airport.deleteMany({ where: { iata: "QQQ" } });
    await prisma.airport.create({
      data: { iata: "QQQ", name: "Audit Test Field", lat: 0, lon: 0 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.airport.deleteMany({ where: { iata: "QQQ" } });
  });

  it("answers 401 to an unauthenticated caller — this route writes on a miss", async () => {
    const res = await request(app).get("/api/v1/airports/QQQ");
    expect(res.status).toBe(401);
  });

  it("keeps /search public, because it only reads", async () => {
    const res = await request(app).get("/api/v1/airports/search").query({ q: "QQQ" });
    expect(res.status).toBe(200);
  });

  it("serves an existing code to a normal account", async () => {
    const res = await request(app).get("/api/v1/airports/QQQ").set("Cookie", userCookie);
    expect(res.status).toBe(200);
    expect(res.body.iata).toBe("QQQ");
  });

  it("serves an existing code to the shared demo account — reading is not the finding", async () => {
    const res = await request(app).get("/api/v1/airports/QQQ").set("Cookie", demoCookie);
    expect(res.status).toBe(200);
    expect(res.body.iata).toBe("QQQ");
  });

  it("does NOT refuse the shared demo account on a miss: rejectDemoWrites lets every GET through", async () => {
    // The measured behaviour, not the intended one. With no provider configured
    // the lookup answers 404 and nothing is written, so this case proves only
    // that the guard did not stop the request — which is the point being
    // recorded. Closing the write itself needs a guard that does not key on the
    // method (audit finding 8).
    const before = await prisma.airport.count();
    const res = await request(app).get("/api/v1/airports/QQZ").set("Cookie", demoCookie);

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    expect(await prisma.airport.count()).toBe(before);
  });
});
