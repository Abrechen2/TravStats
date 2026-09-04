/**
 * forgejo#67 — POST /template-status/sync replaces the instance-wide template
 * registry, so it is an operator action. Until 2026-09-04 any signed-in
 * account could trigger it; the only guard was a 3/h limiter shared by the
 * whole instance.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import request from "supertest";
import { app } from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { templateRegistry } from "../../services/parsers/templates/registry";

async function createUser(isAdmin: boolean): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${isAdmin ? "admin" : "user"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
      isAdmin,
    },
  });
  return generateToken(user.id);
}

describe("template-status — the refresh is an admin action (forgejo#67)", () => {
  let adminToken: string;
  let plainUserToken: string;
  let syncNow: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    await prisma.user.deleteMany();
    adminToken = await createUser(true);
    plainUserToken = await createUser(false);
    // The real sync fans out to raw.githubusercontent.com — never from a test.
    syncNow = jest.spyOn(templateRegistry, "syncNow").mockResolvedValue(0);
  });

  afterEach(async () => {
    syncNow.mockRestore();
    await prisma.user.deleteMany();
  });

  it("refuses a signed-in non-admin with 403 and does not touch the registry", async () => {
    const res = await request(app)
      .post("/api/v1/template-status/sync")
      .set("Cookie", [`auth_token=${plainUserToken}`]);

    expect(res.status).toBe(403);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await request(app).post("/api/v1/template-status/sync");

    expect(res.status).toBe(401);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it("lets an admin refresh", async () => {
    const res = await request(app)
      .post("/api/v1/template-status/sync")
      .set("Cookie", [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(
      expect.objectContaining({ total: 0, templates: expect.any(Array) }),
    );
  });

  it("still answers the status read to every signed-in user", async () => {
    // The list explains which airlines the mail parser understands — a user
    // question. Only the refresh moved behind the admin flag.
    const res = await request(app)
      .get("/api/v1/template-status")
      .set("Cookie", [`auth_token=${plainUserToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ templates: expect.any(Array), total: expect.any(Number) }),
    );
  });
});
