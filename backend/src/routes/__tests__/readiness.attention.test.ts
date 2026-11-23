import request from "supertest";
import app from "../../index";
import { observeQueries, prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resetDiskCache } from "../../services/readiness/context";
import { resetZoneMismatchCache } from "../../services/readiness/problemEntries";

/**
 * `GET /readiness/attention` (the header dot) and `GET /readiness/items/:id/entries`
 * (owner, 2026-11-23): admin items count for admins only, the read costs the same
 * whatever the account holds, and an entry list is refused for an item that has none.
 */

const NAMES = ["att_admin", "att_user", "att_demo"];

describe("Readiness attention", () => {
  let adminCookie: string;
  let userCookie: string;
  let userId: string;

  const addFlightsWithoutTimes = (n: number) =>
    prisma.flight.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId,
        flightNumber: `XX${i}`,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "LIS",
        arrLat: 38.77,
        arrLon: -9.13,
      })),
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
    const mk = async (username: string, isAdmin: boolean, isDemo = false) =>
      prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123"), isAdmin, isDemo },
      });
    const admin = await mk(NAMES[0], true);
    const user = await mk(NAMES[1], false);
    // A live demo account is an admin-only finding.
    await mk(NAMES[2], false, true);
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    resetDiskCache();
    resetZoneMismatchCache();
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.readinessItemState.deleteMany({});
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  it("counts admin items for an admin and never for an ordinary account", async () => {
    const view = await request(app).get("/api/v1/readiness").set("Cookie", adminCookie);
    const demo = view.body.items.find((i: { id: string }) => i.id === "admin.demoAccount");
    expect(demo).toMatchObject({ status: "needsAction", count: 1 });

    const admin = await request(app).get("/api/v1/readiness/attention").set("Cookie", adminCookie);
    const user = await request(app).get("/api/v1/readiness/attention").set("Cookie", userCookie);
    expect(admin.status).toBe(200);
    expect(user.status).toBe(200);
    const userView = await request(app).get("/api/v1/readiness").set("Cookie", userCookie);
    expect(userView.body.items.some((i: { scope: string }) => i.scope === "admin")).toBe(false);
    // The attention read is the page's own summary, nothing else.
    expect(user.body).toEqual({
      problem: userView.body.summary.required,
      warning: userView.body.summary.recommended,
    });
    expect(admin.body.warning).toBeGreaterThan(user.body.warning);
  });

  it("raises the count when entries are tracked wrongly, and drops it on a snooze", async () => {
    // One properly timed flight first, so "choose your travel types" is settled either way.
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "LIS",
        arrLat: 38.77,
        arrLon: -9.13,
        departureTime: new Date("2025-01-01T08:00:00Z"),
        arrivalTime: new Date("2025-01-01T11:00:00Z"),
      },
    });
    const before = (await request(app).get("/api/v1/readiness/attention").set("Cookie", userCookie))
      .body.warning as number;
    await addFlightsWithoutTimes(2);
    const after = await request(app).get("/api/v1/readiness/attention").set("Cookie", userCookie);
    expect(after.body.warning).toBe(before + 1);
    await request(app)
      .post("/api/v1/readiness/items/user.flightsNoTimes/snooze")
      .set("Cookie", userCookie)
      .send({});
    const snoozed = await request(app).get("/api/v1/readiness/attention").set("Cookie", userCookie);
    expect(snoozed.body.warning).toBe(before);
  });

  it("asks the database the same number of times for 1 entry and for 40 (no N+1)", async () => {
    const measure = async (): Promise<number> => {
      resetZoneMismatchCache();
      let n = 0;
      const stop = observeQueries(() => {
        n++;
      });
      try {
        const res = await request(app).get("/api/v1/readiness/attention").set("Cookie", userCookie);
        expect(res.status).toBe(200);
      } finally {
        stop();
      }
      return n;
    };
    await addFlightsWithoutTimes(1);
    const one = await measure();
    await addFlightsWithoutTimes(39);
    const forty = await measure();
    expect(one).toBeGreaterThan(0);
    expect(forty).toBe(one);
  });

  it("lists the entries a data check found, and refuses an item without a list", async () => {
    await addFlightsWithoutTimes(3);
    const res = await request(app)
      .get("/api/v1/readiness/items/user.flightsNoTimes/entries")
      .set("Cookie", userCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries[0]).toMatchObject({
      kind: "flight",
      href: expect.stringMatching(/^\/flights\//),
    });

    const none = await request(app)
      .get("/api/v1/readiness/items/user.domains/entries")
      .set("Cookie", userCookie);
    expect(none.status).toBe(404);
    const adminOnly = await request(app)
      .get("/api/v1/readiness/items/admin.demoAccount/entries")
      .set("Cookie", userCookie);
    expect(adminOnly.status).toBe(404);
  });
});
