import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getAdminFxSettings } from "../../services/parserSettings";

/**
 * The CDN fallback switch (AdminSettings.fxCdnFallbackEnabled).
 *
 * A self-hoster gets to decide whether their instance talks to jsDelivr at
 * all, so the switch has to be reachable — a column only an SQL client can
 * change is not a setting. It sits with the other parser/services settings,
 * where the spec puts it, and only an admin may write it.
 */
describe("FX CDN fallback switch", () => {
  let adminCookie: string;
  let userCookie: string;
  let adminId: string;
  let userId: string;
  /** Restored in afterAll so the dev instance keeps its original value. */
  let original = true;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["fxswitch_admin", "fxswitch_user"] } },
    });
    const admin = await prisma.user.create({
      data: {
        username: "fxswitch_admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: "fxswitch_user", passwordHash: await hashPassword("password123") },
    });
    adminId = admin.id;
    userId = user.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
    original = (await getAdminFxSettings()).cdnFallbackEnabled;
  });

  afterAll(async () => {
    const row = await prisma.adminSettings.findFirst();
    if (row) {
      await prisma.adminSettings.update({
        where: { id: row.id },
        data: { fxCdnFallbackEnabled: original },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await prisma.$disconnect();
  });

  it("is on by default, so a fresh instance can convert a currency the ECB lacks", async () => {
    const res = await request(app).get("/api/v1/admin/parser-settings").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.fxCdnFallbackEnabled).toBe(true);
  });

  it("can be switched off, and the resolver's own reader sees it", async () => {
    const res = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ fxCdnFallbackEnabled: false });
    expect(res.status).toBe(200);
    expect(await getAdminFxSettings()).toEqual({ cdnFallbackEnabled: false });

    const back = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ fxCdnFallbackEnabled: true });
    expect(back.status).toBe(200);
    expect(await getAdminFxSettings()).toEqual({ cdnFallbackEnabled: true });
  });

  it("refuses a non-admin", async () => {
    const res = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", userCookie)
      .send({ fxCdnFallbackEnabled: false });
    expect(res.status).toBe(403);
    expect((await getAdminFxSettings()).cdnFallbackEnabled).toBe(true);
  });
});
