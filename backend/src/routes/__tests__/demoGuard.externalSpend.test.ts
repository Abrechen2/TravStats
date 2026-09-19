import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Two doors of the cold security audit of 2026-09-19 that spend the
 * OPERATOR's money for whoever is logged in as the demo account — which, on a
 * public preview, is every visitor, because the password is printed on the
 * login page.
 *
 *   Finding 2: `/flight-lookup/:flightNumber` and `/flight-lookup/bulk` (ten
 *   per call) resolve the instance key — `apiKeyResolver` has no per-user
 *   branch for this provider — so every lookup is a billed RapidAPI call. The
 *   bulk historical refresh in `routes/flights.ts` was already guarded; these
 *   two were not.
 *
 *   Finding 4: `/lodging-import/commit` geocodes through Google Places, billed
 *   per request, and `/preview` is what produces the rows it is given.
 *   `/suggest-mapping` beside them asks the admin's Ollama.
 *
 * The two guards are deliberately DIFFERENT and the difference is the point.
 * `rejectDemoQuota` asks `isDemo` alone, so every seeded account is refused —
 * the preview's `admin`, `alex` and `claude` and the local dev admin too,
 * because their sample flights cost real quota whoever asks. `rejectDemo` asks
 * `isSharedDemoAccount`, so only the published login is refused and the other
 * seeded accounts keep their own import. `utils/sharedDemo.ts` says why.
 *
 * Every request below is shaped so the un-refused direction fails on
 * VALIDATION rather than reaching a provider: no case in this file may make a
 * network call, or the suite would bill the operator to prove it does not.
 */
describe("routes that spend an external quota, and the demo accounts", () => {
  let sharedDemoCookie: string;
  let flaggedUserCookie: string;
  let userCookie: string;
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["demo", "spendDemo", "spendUser"] } },
    });
    const shared = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    // The shape `seedDemoUser` leaves behind: flagged, but its own account.
    const flagged = await prisma.user.create({
      data: { username: "spendDemo", passwordHash: await hashPassword("flagged123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "spendUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(shared.id, flagged.id, user.id);
    sharedDemoCookie = `auth_token=${generateToken(shared.id)}`;
    flaggedUserCookie = `auth_token=${generateToken(flagged.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  describe("finding 2 — flight lookup spends the RapidAPI quota", () => {
    // `date=not-a-date` is rejected by the handler before any provider is
    // resolved, so the un-refused direction proves the guard passed without
    // making a lookup.
    const single = "/api/v1/flight-lookup/LH123?date=not-a-date";

    it("refuses the single lookup for the shared demo account", async () => {
      const res = await request(app).get(single).set("Cookie", sharedDemoCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
      expect(res.body.message).toMatch(/RapidAPI quota/);
    });

    it("refuses the bulk lookup for the shared demo account", async () => {
      const res = await request(app)
        .post("/api/v1/flight-lookup/bulk")
        .set("Cookie", sharedDemoCookie)
        // An empty body, so the un-guarded code path 400s on validation rather
        // than resolving ten providers: measured while proving this test fails
        // without the guard, a real `flightNumbers` list answered 200 because
        // the handler HAD run the cascade.
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
      expect(res.body.message).toMatch(/RapidAPI quota/);
    });

    it("refuses a seeded account that is not the shared one, because the quota is the same", async () => {
      const res = await request(app).get(single).set("Cookie", flaggedUserCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("does not refuse a normal account", async () => {
      const res = await request(app).get(single).set("Cookie", userCookie);
      expect(res.status).toBe(400);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");

      const bulk = await request(app)
        .post("/api/v1/flight-lookup/bulk")
        .set("Cookie", userCookie)
        .send({});
      expect(bulk.status).toBe(400);
      expect(bulk.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });
  });

  describe("finding 4 — the lodging import spends the Google Places key", () => {
    // An empty body is rejected by the request schema, so the un-refused
    // direction never reaches the geocoder or the model.
    const paths = ["/api/v1/lodging-import/preview", "/api/v1/lodging-import/commit"];

    it.each(paths)("refuses %s for the shared demo account", async (path) => {
      const res = await request(app).post(path).set("Cookie", sharedDemoCookie).send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("refuses the mapping suggestion too, which asks the admin's Ollama", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-import/suggest-mapping")
        .set("Cookie", sharedDemoCookie)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it.each(paths)("does not refuse %s for a normal account", async (path) => {
      const res = await request(app).post(path).set("Cookie", userCookie).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("does not refuse a seeded account that is not the shared one", async () => {
      // `rejectDemo`, not `rejectDemoQuota`: the preview's `admin`, `alex` and
      // `claude` import their own stays, and only the published login is shared.
      const res = await request(app)
        .post("/api/v1/lodging-import/preview")
        .set("Cookie", flaggedUserCookie)
        .send({});
      expect(res.body.error).not.toBe("DEMO_ACCOUNT_FORBIDDEN");
    });

    it("still lets the shared demo account read and undo its own import batches", async () => {
      const res = await request(app)
        .get("/api/v1/lodging-import/batches")
        .set("Cookie", sharedDemoCookie);
      expect(res.status).toBe(200);
    });
  });
});
