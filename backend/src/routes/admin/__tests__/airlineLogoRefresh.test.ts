import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import * as scheduler from "../../../jobs/airlineLogoRefreshScheduler";
import { __resetLogoRefreshStatusForTests } from "../system";

/**
 * Covers the admin-triggered airline logo refresh sweep (mirrors the
 * airport re-seed pair). Two isolation seams are load-bearing here:
 *
 * 1. `logoRefreshStatus` is module-level state, so every test resets it
 *    via `__resetLogoRefreshStatusForTests` first — otherwise the "refuses
 *    a second sweep" test (which never resolves its mock) would leave
 *    running=true forever and poison the later "reports the last result"
 *    test.
 * 2. `adminReseedLimiter` (reused from the airport re-seed endpoint) caps
 *    an admin user at 3 POSTs/hour, keyed by userId. Sharing one admin
 *    cookie across this file's tests (1 + 2 + 1 = 4 POSTs) would trip that
 *    limit on the 4th call and silently turn it into a 429 instead of the
 *    202 the test expects — so each POST-issuing test gets its OWN fresh
 *    admin user, keeping every bucket well under the cap.
 */
describe("POST /api/v1/admin/airline-logos/refresh", () => {
  let nonAdminUser: { id: string };
  let nonAdminCookie: string;
  const createdUserIds: string[] = [];

  const neverResolves = () => new Promise(() => {});
  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  const createAdminCookie = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        username: `admin-logo-refresh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    createdUserIds.push(user.id);
    return `auth_token=${generateToken(user.id)}`;
  };

  beforeAll(async () => {
    nonAdminUser = await prisma.user.create({
      data: {
        username: `user-logo-refresh-test-${Date.now()}`,
        passwordHash: await hashPassword("user-password"),
        isAdmin: false,
        isActive: true,
      },
    });
    nonAdminCookie = `auth_token=${generateToken(nonAdminUser.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: nonAdminUser.id } }).catch(() => {});
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  beforeEach(() => {
    __resetLogoRefreshStatusForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requires admin", async () => {
    await request(app)
      .post("/api/v1/admin/airline-logos/refresh")
      .set("Cookie", nonAdminCookie)
      .expect(403);
  });

  it("starts a sweep and returns immediately", async () => {
    const adminCookie = await createAdminCookie();
    const spy = jest.spyOn(scheduler, "sweepStaleLogos").mockResolvedValue({ checked: 5, refreshed: 2 });
    await request(app)
      .post("/api/v1/admin/airline-logos/refresh")
      .set("Cookie", adminCookie)
      .expect(202);
    expect(spy).toHaveBeenCalled();
  });

  it("refuses a second sweep while one is running", async () => {
    const adminCookie = await createAdminCookie();
    jest.spyOn(scheduler, "sweepStaleLogos").mockImplementation(() => neverResolves());
    await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie).expect(202);
    await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie).expect(409);
  });

  it("reports the last result", async () => {
    const adminCookie = await createAdminCookie();
    jest.spyOn(scheduler, "sweepStaleLogos").mockResolvedValue({ checked: 5, refreshed: 2 });
    await request(app).post("/api/v1/admin/airline-logos/refresh").set("Cookie", adminCookie);
    await flushPromises();
    const res = await request(app)
      .get("/api/v1/admin/airline-logos/refresh-status")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(res.body).toMatchObject({ running: false, checked: 5, refreshed: 2 });
  });
});
