import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

// adsb.lol is left out: its service guard answers 409 until the admin enables it.
const PROVIDERS = [
  "airlabs",
  "aviationstack",
  "aerodatabox",
  "aeroapi",
  "adsbx",
  "openrouteservice",
  "graphhopper",
];

describe("key-test routes answer 'no key saved' with a stable code", () => {
  let userId: string;
  let adminId: string;
  let cookie: string;
  let adminCookie: string;
  let rowId: number | undefined;
  let created = false;

  const mk = async (name: string, isAdmin: boolean) =>
    (
      await prisma.user.create({
        data: {
          username: `akt-${name}-${Date.now()}`,
          passwordHash: await hashPassword("pw-123456"),
          isAdmin,
          isActive: true,
        },
      })
    ).id;

  beforeAll(async () => {
    userId = await mk("user", false);
    adminId = await mk("admin", true);
    cookie = `auth_token=${generateToken(userId)}`;
    adminCookie = `auth_token=${generateToken(adminId)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (existing) rowId = existing.id;
    else {
      rowId = (await prisma.adminSettings.create({ data: {} })).id;
      created = true;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
    if (created && rowId) await prisma.adminSettings.delete({ where: { id: rowId } });
  });

  it.each(PROVIDERS)(
    "account route /test/%s carries messageKey notConfigured (was English prose only)",
    async (provider) => {
      const res = await request(app)
        .post(`/api/v1/settings/api-keys/test/${provider}`)
        .set("Cookie", cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.messageKey).toBe("notConfigured");
    }
  );

  it.each([...PROVIDERS, "logostream", "googlePlaces"])(
    "admin route /api-keys/test/%s keeps its notConfigured answer",
    async (provider) => {
      const res = await request(app)
        .post(`/api/v1/admin/api-keys/test/${provider}`)
        .set("Cookie", adminCookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.messageKey).toBe("notConfigured");
    }
  );
});
