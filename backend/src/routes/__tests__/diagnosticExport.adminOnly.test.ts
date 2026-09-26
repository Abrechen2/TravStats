import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Owner decision 2026-09-25: the diagnostic export carries log tails of EVERY
 * account on the instance (scrubbed of identity, not of flight numbers, routes
 * and times), so only an admin may download it. Before, any signed-in account
 * except the shared demo login got it.
 */
describe("GET /diagnostic-export is admin-only", () => {
  const ids: string[] = [];
  let adminCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["diagExportAdmin", "diagExportUser"] } },
    });
    const admin = await prisma.user.create({
      data: {
        username: "diagExportAdmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: "diagExportUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(admin.id, user.id);
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("refuses an ordinary account with 403", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", userCookie);
    expect(res.status).toBe(403);
    expect(res.body.logs).toBeUndefined();
  });

  it("serves the bundle to an admin", async () => {
    const res = await request(app).get("/api/v1/diagnostic-export").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.logs).toBeDefined();
  });

  it("leaves the user-scoped diagnostics snapshot open to an ordinary account", async () => {
    const res = await request(app).get("/api/v1/diagnostics").set("Cookie", userCookie);
    expect(res.status).toBe(200);
  });
});
