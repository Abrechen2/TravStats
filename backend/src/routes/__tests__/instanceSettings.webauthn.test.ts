import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("admin instance-settings — WebAuthn relying party", () => {
  let cookie: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "rpAdmin" } });
    const admin = await prisma.user.create({
      data: {
        username: "rpAdmin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    cookie = `auth_token=${generateToken(admin.id)}`;

    const row = await prisma.adminSettings.findFirst({ select: { id: true } });
    const clean = { webauthnRpId: null, webauthnOrigins: [], publicUrl: null };
    if (row) await prisma.adminSettings.update({ where: { id: row.id }, data: clean });
    else await prisma.adminSettings.create({ data: clean });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rpAdmin" } });
    const row = await prisma.adminSettings.findFirst({ select: { id: true } });
    if (row) {
      await prisma.adminSettings.update({
        where: { id: row.id },
        data: { webauthnRpId: null, webauthnOrigins: [], publicUrl: null },
      });
    }
  });

  it("reports passkeys as unusable while nothing is configured", async () => {
    const res = await request(app).get("/api/v1/admin/instance-settings").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.settings.webauthnRpId).toBeNull();
    expect(res.body.settings.webauthnOrigins).toEqual([]);
    expect(res.body.passkeyStatus).toEqual({ usable: false, reason: "notConfigured" });
  });

  it("saves an rpId and origin, and says passkeys now work", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({
        webauthnRpId: "trav.example.com",
        webauthnOrigins: ["https://trav.example.com"],
      });

    expect(res.status).toBe(200);
    expect(res.body.settings.webauthnRpId).toBe("trav.example.com");
    expect(res.body.settings.webauthnOrigins).toEqual(["https://trav.example.com"]);
    expect(res.body.passkeyStatus).toEqual({ usable: true, reason: null });
  });

  // The whole point of validating here: a credential is bound to the rpId
  // forever, so a URL pasted into that field must be refused at save time and
  // not discovered later as passkeys that silently never work.
  it("refuses a URL in the rpId field", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({ webauthnRpId: "https://trav.example.com" });
    expect(res.status).toBe(400);
  });

  it("refuses a bare IP as the rpId", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({ webauthnRpId: "192.168.178.120" });
    expect(res.status).toBe(400);
  });

  it("refuses an origin that is not an http(s) URL", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({ webauthnOrigins: ["trav.example.com"] });
    expect(res.status).toBe(400);
  });

  // Saving a plain-http LAN origin is ALLOWED — an admin may legitimately have
  // one — but the response must say plainly that passkeys will not work there
  // rather than pretending the save achieved something.
  it("accepts a plain-http LAN origin but reports it as unusable", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({ webauthnOrigins: ["http://192.168.178.120:3010"] });

    expect(res.status).toBe(200);
    expect(res.body.passkeyStatus).toEqual({ usable: false, reason: "insecureOrigin" });
  });

  it("drops blank origin rows instead of storing them", async () => {
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({
        webauthnRpId: "trav.example.com",
        webauthnOrigins: ["https://trav.example.com", "", "  "],
      });

    expect(res.status).toBe(200);
    expect(res.body.settings.webauthnOrigins).toEqual(["https://trav.example.com"]);
  });

  it("clearing the origins turns passkeys off again", async () => {
    await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({
        webauthnRpId: "trav.example.com",
        webauthnOrigins: ["https://trav.example.com"],
      });

    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", cookie)
      .send({ webauthnOrigins: [] });

    expect(res.status).toBe(200);
    expect(res.body.settings.webauthnOrigins).toEqual([]);
    expect(res.body.passkeyStatus.usable).toBe(false);
  });

  it("is admin-only", async () => {
    const plain = await prisma.user.create({
      data: { username: "rpNotAdmin", passwordHash: await hashPassword("password123") },
    });
    const res = await request(app)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", `auth_token=${generateToken(plain.id)}`)
      .send({ webauthnRpId: "trav.example.com" });
    expect(res.status).toBe(403);
    await prisma.user.deleteMany({ where: { username: "rpNotAdmin" } });
  });
});
