import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as resolver from "../../services/apiKeyResolver";

/**
 * A failed admin-settings read or access check used to become
 * `{ hasAccess: false }` for every provider behind a 200, so a transient
 * database or decrypt failure showed every API key as "not configured" and
 * users entered keys again (forgejo#369). It must reach the user as a failure.
 */
describe("GET settings/api-keys when the instance state cannot be read", () => {
  let user: { id: string };
  let cookie: string;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        username: `apikeys-fail-${Date.now()}`,
        passwordHash: await hashPassword("pw-123456"),
        isActive: true,
      },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  it("answers 5xx, not 200 with every key 'not configured', when the admin-settings read fails", async () => {
    jest.spyOn(prisma.adminSettings, "findFirst").mockRejectedValue(new Error("db down"));
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", cookie);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("answers 5xx, not 200 with hasAccess false, when the access check fails", async () => {
    jest.spyOn(resolver, "hasApiKeyAccess").mockRejectedValue(new Error("decrypt failed"));
    const res = await request(app).get("/api/v1/settings/api-keys").set("Cookie", cookie);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
