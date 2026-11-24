import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("settings enabledDomains", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const timestamp = Date.now();
    const user = await prisma.user.create({
      data: {
        username: `settings-enabled-domains-${timestamp}`,
        passwordHash: await hashPassword("password123"),
        isAdmin: false,
        isActive: true,
      },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("GET /settings returns default enabledDomains for a fresh user", async () => {
    const res = await request(app)
      .get("/api/v1/settings")
      .set("Cookie", [`auth_token=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(["flight"]);
  });

  it("PUT /settings persists enabledDomains", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", [`auth_token=${token}`])
      .send({ enabledDomains: ["flight", "cruise"] });
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(["flight", "cruise"]);
  });

  it("PUT /settings rejects unknown domain keys", async () => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", [`auth_token=${token}`])
      .send({ enabledDomains: ["flight", "rockets"] });
    expect(res.status).toBe(400);
  });
  it("keeps supported domains discoverable after switching them off", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", [`auth_token=${token}`])
      .send({ enabledDomains: ["flight"], availableDomains: ["rockets"] })
      .expect(200);
    const res = await request(app)
      .get("/api/v1/settings")
      .set("Cookie", [`auth_token=${token}`])
      .expect(200);
    expect(res.body.enabledDomains).toEqual(["flight"]);
    expect(res.body.availableDomains).toEqual(expect.arrayContaining(["bus", "rental", "ferry"]));
    expect(res.body.availableDomains).not.toContain("rockets");
  });

  /**
   * UAT rc.45 B1: a settings page PUT the whole store before its first load,
   * and the store default `enabledDomains: ["flight"]` switched every other
   * domain off. The server now refuses a shrinking list inside a larger write
   * unless each removed domain is named.
   */
  describe("refuses a domain removal the write does not name (UAT rc.45 B1)", () => {
    const put = (body: Record<string, unknown>) =>
      request(app)
        .put("/api/v1/settings")
        .set("Cookie", [`auth_token=${token}`])
        .send(body);

    beforeEach(async () => {
      await put({ enabledDomains: ["flight", "lodging", "bus"] }).expect(200);
      await put({ display: { language: "de" }, profile: { firstName: "Ada" } }).expect(200);
    });

    it("refuses a full default object that cuts the domains to flights, and writes nothing", async () => {
      const res = await put({
        profile: { firstName: null, lastName: null },
        display: { language: "en", theme: "light", dateFormat: "MM/DD/YYYY" },
        enabledDomains: ["flight"],
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("DOMAIN_REMOVAL_UNCONFIRMED");
      expect(res.body.domains).toEqual(["lodging", "bus"]);
      const after = await request(app)
        .get("/api/v1/settings")
        .set("Cookie", [`auth_token=${token}`])
        .expect(200);
      expect(after.body.enabledDomains).toEqual(["flight", "lodging", "bus"]);
      expect(after.body.display.language).toBe("de");
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.firstName).toBe("Ada");
    });

    it("accepts the removal when every removed domain is named", async () => {
      const res = await put({
        display: { theme: "dark" },
        enabledDomains: ["flight"],
        removedDomains: ["lodging", "bus"],
      });
      expect(res.status).toBe(200);
      expect(res.body.enabledDomains).toEqual(["flight"]);
    });

    it("refuses when only some of the removed domains are named", async () => {
      const res = await put({
        display: { theme: "dark" },
        enabledDomains: ["flight"],
        removedDomains: ["bus"],
      });
      expect(res.status).toBe(409);
      expect(res.body.domains).toEqual(["lodging"]);
    });

    it("accepts a domains-only write as explicit (the installed Companion's switch)", async () => {
      const res = await put({ enabledDomains: ["flight", "lodging"] });
      expect(res.status).toBe(200);
      expect(res.body.enabledDomains).toEqual(["flight", "lodging"]);
    });
  });
});
