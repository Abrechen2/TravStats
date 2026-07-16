import { describe, it, expect, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";

/**
 * Covers the admin-triggered airline/aircraft catalogue reseed endpoints
 * (mirrors the airport re-seed + airline logo refresh pairs).
 *
 * `adminReseedLimiter` (shared across all three reseed-style endpoints) caps
 * an admin user at 3 POSTs/hour, keyed by userId — so every POST-issuing
 * test gets its OWN fresh admin user, exactly like airlineLogoRefresh.test.ts,
 * to stay well under the cap regardless of test run order.
 */
describe("POST /api/v1/admin/airlines/reseed and /api/v1/admin/aircraft/reseed", () => {
  let nonAdminUser: { id: string };
  let nonAdminCookie: string;
  const createdUserIds: string[] = [];

  const createAdminCookie = async (): Promise<string> => {
    const user = await prisma.user.create({
      data: {
        username: `admin-catalogue-reseed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
        username: `user-catalogue-reseed-test-${Date.now()}`,
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

  it("requires admin for airlines reseed", async () => {
    await request(app)
      .post("/api/v1/admin/airlines/reseed")
      .set("Cookie", nonAdminCookie)
      .expect(403);
  });

  it("requires admin for aircraft reseed", async () => {
    await request(app)
      .post("/api/v1/admin/aircraft/reseed")
      .set("Cookie", nonAdminCookie)
      .expect(403);
  });

  it("requires auth entirely for airlines reseed", async () => {
    await request(app).post("/api/v1/admin/airlines/reseed").expect(401);
  });

  it("re-seeds airlines and returns a numeric inserted count", async () => {
    const adminCookie = await createAdminCookie();
    const res = await request(app)
      .post("/api/v1/admin/airlines/reseed")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(typeof res.body.inserted).toBe("number");
    expect(res.body.inserted).toBeGreaterThanOrEqual(0);
  });

  it("re-seeds aircraft and returns a numeric inserted count", async () => {
    const adminCookie = await createAdminCookie();
    const res = await request(app)
      .post("/api/v1/admin/aircraft/reseed")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(typeof res.body.inserted).toBe("number");
    expect(res.body.inserted).toBeGreaterThanOrEqual(0);
  });
});
