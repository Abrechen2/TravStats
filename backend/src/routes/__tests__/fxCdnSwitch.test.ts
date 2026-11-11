import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { getAdminFxSettings } from "../../services/parserSettings";

/**
 * The CDN fallback has no switch of its own since settings v3 S6 (it runs under
 * the master internet switch). A client that still sends `fxCdnFallbackEnabled`
 * is not refused (rule 6, additive API): the field is accepted and ignored, and
 * the answer no longer carries it.
 */
describe("FX CDN fallback: no switch of its own", () => {
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "fxswitch_admin" } });
    const admin = await prisma.user.create({
      data: {
        username: "fxswitch_admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("the parser settings no longer report a CDN switch, and the reader has none", async () => {
    const res = await request(app).get("/api/v1/admin/parser-settings").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("fxCdnFallbackEnabled");
    expect(await getAdminFxSettings()).not.toHaveProperty("cdnFallbackEnabled");
  });

  it("a client that still sends the old field is answered 200 and nothing changes", async () => {
    const before = await getAdminFxSettings();
    const res = await request(app)
      .put("/api/v1/admin/parser-settings")
      .set("Cookie", adminCookie)
      .send({ fxCdnFallbackEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("fxCdnFallbackEnabled");
    expect(await getAdminFxSettings()).toEqual(before);
  });
});
