import request from "supertest";
import { authenticator } from "otplib";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { decryptSecret } from "../../services/twoFactor/totpService";

describe("two-factor setup", () => {
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "setupUser" } });
    const user = await prisma.user.create({
      data: { username: "setupUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "setupUser" } });
  });

  it("reports two-factor as off for a fresh account", async () => {
    const res = await request(app).get("/api/v1/auth/2fa/status").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("hands out a secret and an otpauth URL, and stores the secret as PENDING", async () => {
    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.otpauthUrl).toContain("otpauth://totp/");

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorPendingSecret).toBeTruthy();
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("stores the pending secret encrypted", async () => {
    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorPendingSecret).not.toBe(res.body.secret);
    expect(decryptSecret(row!.twoFactorPendingSecret!)).toBe(res.body.secret);
  });

  it("activates on a correct first code and returns recovery codes", async () => {
    const setup = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const code = authenticator.generate(setup.body.secret);

    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorSecret).toBeTruthy();
    expect(row?.twoFactorPendingSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  // An abandoned setup must not half-enable anything, or the next login asks
  // for a code the user never finished configuring.
  it("stays off when the first code is wrong", async () => {
    await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code: "000000" });

    expect(res.status).toBe(400);
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("refuses to activate when no setup was started", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code: "123456" });
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await request(app).post("/api/v1/auth/2fa/setup")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/2fa/status")).status).toBe(401);
  });
});
