import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Task 3 ships plumbing only — no resolver is wired
 * (`services/evidence/index.ts`'s `DEFAULT_RESOLVERS` is empty; the first
 * one arrives in Task 5). So this suite covers only what needs none: the
 * four answers that reduce to the same empty-resolver path, plus 501 and
 * 401. The 0-case and the null-case are unit-tested against injected fakes
 * in `services/evidence/__tests__/index.test.ts` instead — see the ruling
 * in `.superpowers/sdd/2026-09-18-evidence-panel/task-3-brief.md`.
 */
describe("GET /api/v1/evidence/:kind/:key — contract", () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencecontracttest" } });
    const user = await prisma.user.create({
      data: { username: "evidencecontracttest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("answers 401 unauthenticated", async () => {
    const res = await request(app).get("/api/v1/evidence/metric/flights.total");
    expect(res.status).toBe(401);
  });

  it("answers 404 for a key it does not serve — no resolver is wired for metric/ranking yet", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/ranking/airline:ZZZZ")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });

  /**
   * A 403 would confirm the row exists (spec, "Four answers that are not
   * the same answer"). With no resolver wired at all, a key shaped like
   * someone else's row travels the SAME empty-resolver path as an unknown
   * key — which is exactly the point: the endpoint cannot distinguish the
   * two shapes of "not yours to see", and answers 404 either way.
   */
  it("answers 404, never 403, for what would be another user's row", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/someone-elses-metric")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it.each(["record", "achievement"] as const)(
    "answers 501 for kind '%s' — release 2, not missing",
    async (kind) => {
      const res = await request(app)
        .get(`/api/v1/evidence/${kind}/anything`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(501);
    }
  );

  it("answers 400 for a kind this endpoint does not recognise at all", async () => {
    const res = await request(app).get("/api/v1/evidence/bogus/anything").set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("answers 400 when period=year is missing its year", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flights.total?period=year")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("answers no-store on the 404 path like every other /api response", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flights.total")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
