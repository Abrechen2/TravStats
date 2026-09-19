import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Task 3 shipped plumbing only — no resolver was wired. Task 5 (this branch)
 * registers the first one, `ranking`'s `airline` dimension
 * (`services/evidence/rankingEvidence.ts`), but `metric` still has none
 * (Task 7) and `ranking`'s other four dimensions still answer `unknownKey`
 * from inside that resolver (Task 6). So this suite still covers only what
 * needs no live data: malformed keys, unserved kinds, and auth — the 0-case
 * and the null-case against the real airline resolver belong to
 * `evidence.rankingAirline.test.ts` instead, and the fake-injection cases
 * from before Task 5 existed still live in
 * `services/evidence/__tests__/index.test.ts` (see the ruling in
 * `.superpowers/sdd/2026-09-18-evidence-panel/task-3-brief.md`).
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

  it("answers 404 for a key it does not serve — 'ZZZZ' is not a shape `groupAirlines` ever produces", async () => {
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

  /**
   * A stray `year` with a non-year period used to pass validation and get
   * silently dropped by `evidenceScopeFromQuery` — hiding a frontend bug
   * exactly where every other malformed request here fails loudly instead.
   */
  it("answers 400 when year is sent alongside a period other than 'year'", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flights.total?period=allTime&year=2026")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  /**
   * `?domains=` is honoured by exactly three measures — the cross-domain KPI
   * strip — and the registry says which by carrying `domainFiltered`. Every
   * other resolver ignores the field, while `evidenceScopeFromQuery` still
   * copies it into `measure.scope.domains` and the response echoes it back.
   *
   * A scope echoed but not honoured is a LIE in the response:
   * `lodgingStaysCount?domains=cruise` answered every stay under a scope
   * claiming it had counted only cruises, and the panel's whole premise is
   * that `measure.scope` describes `measure.value`. Refused, exactly as the
   * stray `year` above is refused rather than silently dropped.
   */
  it("answers 400 when domains are sent to a measure that does not narrow by them", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/lodgingStaysCount?domains=cruise")
      .set("Cookie", authCookie);
    expect(res.status).toBe(400);
  });

  it("answers 200 when domains are sent to a measure that DOES narrow by them", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/crossDomainEventCount?domains=cruise")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.scope.domains).toEqual(["cruise"]);
  });

  /**
   * The order inside the dispatcher matters: an unknown key must stay a 404
   * even when the request is also malformed, or a 400 would tell a caller
   * that the key exists and something else was wrong with the request.
   */
  it("still answers 404, not 400, for an unknown key sent with domains", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flights.total?domains=cruise")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });

  it("answers no-store on the 404 path like every other /api response", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/flights.total")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
