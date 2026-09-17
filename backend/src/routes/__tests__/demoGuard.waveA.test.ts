import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * An independent review on 2026-09-17 found a second set of doors the shared
 * demo account could still walk through on a PUBLIC instance, where the
 * password is printed on the login page. Each case below is one of those
 * findings; the describe block names it.
 *
 * "It" is the SHARED demo account — `isDemo` AND username `demo` — never every
 * row carrying `isDemo`; see `utils/sharedDemo.ts` for why the flag alone is
 * the wrong question.
 */
describe("Wave A demo guards", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "waveAUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "waveAUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    // The "a normal account is not refused" half of A3 really writes into the
    // global catalogues — that is the point of the finding — so this suite
    // takes its own rows back out again.
    await prisma.port.deleteMany({ where: { name: "Demoport" } });
    await prisma.ship.deleteMany({ where: { name: "Demoship" } });
    await prisma.airline.deleteMany({ where: { name: "Demo Air" } });
    await prisma.aircraft.deleteMany({ where: { name: "Demo 100" } });
    await prisma.airport.deleteMany({ where: { iata: "ZZZ" } });
    await prisma.lodgingChain.deleteMany({ where: { name: "Demo Hotels" } });
  });

  /**
   * A1. `/diagnostic-export` returns SERVER-WIDE log tails — every account's
   * flight numbers, routes and times pass the scrubber, which only removes
   * identity. On a public instance that is one authenticated GET away from
   * anybody. Whether an ordinary user should get server-wide logs at all is an
   * owner decision and a board item; the shared login is refused now.
   */
  describe("A1 server-wide diagnostic export", () => {
    it("refuses the diagnostic export for the shared demo account", async () => {
      const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", demoCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still serves the diagnostic export to a normal account", async () => {
      const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still serves the user-scoped diagnostics bundle to the shared demo account", async () => {
      // `/diagnostics` is the caller's OWN data, not the server's logs, so it
      // stays open — the guard must not be widened to the whole family.
      const res = await request(app).get("/api/v1/diagnostics").set("Cookie", demoCookie);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });
  });

  /**
   * A3. The six GLOBAL catalogues — ports, ships, airlines, aircraft, airports
   * and lodging chains — are the only rows in this application every account
   * reads. A write there is visible to everybody, and `wipeDemoUser` does not
   * touch it, so it outlives the nightly reseed: a visitor could leave
   * "Lufthansa (idiot)" in the catalogue of a public instance permanently.
   * Reads stay open — the typeaheads are most of what a visitor came to try.
   */
  describe("A3 global catalogue writes", () => {
    const catalogueWrites: Array<[string, object]> = [
      ["/api/v1/ports", { name: "Demoport", lat: 1, lon: 1 }],
      ["/api/v1/ships", { name: "Demoship", cruiseLine: "Demo Line" }],
      ["/api/v1/airlines", { name: "Demo Air" }],
      ["/api/v1/aircraft", { name: "Demo 100" }],
      ["/api/v1/airports", { iata: "ZZZ", name: "Demo Field", lat: 1, lon: 1 }],
      ["/api/v1/lodging-chains", { name: "Demo Hotels" }],
    ];

    it.each(catalogueWrites)("refuses POST %s for the shared demo account", async (path, body) => {
      const res = await request(app).post(path).set("Cookie", demoCookie).send(body);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it.each(catalogueWrites)("does not refuse POST %s for a normal account", async (path, body) => {
      const res = await request(app).post(path).set("Cookie", userCookie).send(body);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    const catalogueReads = [
      "/api/v1/ports",
      "/api/v1/ships",
      "/api/v1/airlines",
      "/api/v1/aircraft",
      "/api/v1/lodging-chains",
    ];

    it.each(catalogueReads)("still lets the shared demo account read %s", async (path) => {
      const res = await request(app).get(path).set("Cookie", demoCookie);
      expect(res.status).toBe(200);
    });
  });

  /**
   * A4. Auto-update and historical enrichment are not preferences — they are
   * switches that start BACKGROUND WORK against the instance's provider keys,
   * unattended, for an account nobody owns. A visitor could turn both on and
   * spend the operator's RapidAPI quota on 160 seeded sample flights.
   *
   * Refused exactly like the `profile` block, and for the same reason: the
   * rest of the settings PUT — theme, units, map colours — is what a visitor
   * came to try, so the refusal is on these two blocks and not on the route.
   */
  describe("A4 settings that start background work", () => {
    const refusedBlocks: Array<[string, object]> = [
      ["autoUpdate", { autoUpdate: { enabled: true } }],
      ["historicalEnrichment", { historicalEnrichment: { enabled: true } }],
    ];

    it.each(refusedBlocks)(
      "refuses a settings PUT carrying the %s block for the shared demo account",
      async (_name, body) => {
        const res = await request(app).put("/api/v1/settings").set("Cookie", demoCookie).send(body);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
      },
    );

    it.each(refusedBlocks)(
      "does not refuse the %s block for a normal account",
      async (_name, body) => {
        const res = await request(app).put("/api/v1/settings").set("Cookie", userCookie).send(body);
        expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
      },
    );

    it("leaves the rest of the settings PUT open for the shared demo account", async () => {
      const res = await request(app)
        .put("/api/v1/settings")
        .set("Cookie", demoCookie)
        .send({ display: { theme: "dark" } });
      expect(res.status).toBe(200);
    });
  });

  /**
   * A6. `coverImageUrl` accepts any URL and the image is then rendered on the
   * trip for every later visitor — the same harm the profile picture already
   * carries, plus one more: the owner of that URL learns the IP of everybody
   * who opens the trip. The trip's other fields stay editable, because keeping
   * a journey is what a visitor came to try.
   */
  describe("A6 trip cover image URL", () => {
    let demoTripId: string;

    beforeAll(async () => {
      const trip = await prisma.trip.create({
        data: { userId: ids[0], name: "Cover trip", startDate: new Date("2026-02-01") },
        select: { id: true },
      });
      demoTripId = trip.id;
    });

    afterAll(async () => {
      await prisma.trip.deleteMany({ where: { userId: ids[0] } });
      await prisma.trip.deleteMany({ where: { userId: ids[1] } });
    });

    it("refuses a cover image URL on trip create for the shared demo account", async () => {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Cookie", demoCookie)
        .send({ name: "Tracked", coverImageUrl: "https://tracker.example/pixel.png" });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("refuses a cover image URL on trip update for the shared demo account", async () => {
      const res = await request(app)
        .patch(`/api/v1/trips/${demoTripId}`)
        .set("Cookie", demoCookie)
        .send({ coverImageUrl: "https://tracker.example/pixel.png" });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still lets the shared demo account create and edit a trip otherwise", async () => {
      const created = await request(app)
        .post("/api/v1/trips")
        .set("Cookie", demoCookie)
        .send({ name: "An ordinary journey" });
      expect(created.status).toBe(201);

      const edited = await request(app)
        .patch(`/api/v1/trips/${demoTripId}`)
        .set("Cookie", demoCookie)
        .send({ name: "Renamed" });
      expect(edited.status).toBe(200);
    });

    it("does not refuse a cover image URL for a normal account", async () => {
      const created = await request(app)
        .post("/api/v1/trips")
        .set("Cookie", userCookie)
        .send({ name: "Real trip", coverImageUrl: "https://example.com/cover.png" });
      expect(created.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
      expect(created.status).toBe(201);

      const edited = await request(app)
        .patch(`/api/v1/trips/${created.body.trip.id}`)
        .set("Cookie", userCookie)
        .send({ coverImageUrl: "https://example.com/other.png" });
      expect(edited.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
      expect(edited.status).toBe(200);
    });
  });
});
