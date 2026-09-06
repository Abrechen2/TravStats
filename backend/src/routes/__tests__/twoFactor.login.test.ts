import request from "supertest";
import { createGuardrails, generateSync } from "otplib";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { encryptSecret } from "../../services/twoFactor/totpService";
import { generateRecoveryCodes } from "../../services/twoFactor/recoveryCodeService";

// Sixteen base32 characters = 10 bytes: the size otplib 12's generateSecret()
// wrote for every account enrolled before the otplib 13 upgrade. Keep it this
// short on purpose — 13's default floor is 16 bytes, and this fixture is what
// proves those accounts still get in (see LEGACY_SECRET_BYTES in totpService).
const SECRET = "JBSWY3DPEHPK3PXP";
// otplib 13 applies the same floor when GENERATING, so the test's own code
// generator has to be told; the server under test must not need to be.
const legacyGuardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });
const codeFor = (secret: string): string => generateSync({ secret, guardrails: legacyGuardrails });

async function makeUserWithTwoFactor(username: string): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("password123"),
      twoFactorSecret: encryptSecret(SECRET),
      twoFactorEnabledAt: new Date(),
    },
  });
  return user.id;
}

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

describe("login with two-factor", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUserWithTwoFactor("twoFactorLogin");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "twoFactorLogin" } });
    await prisma.user.deleteMany({ where: { username: "noTwoFactorLogin" } });
  });

  it("answers the password with a challenge instead of a session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requiresTwoFactor: true });
    expect(res.body.user).toBeUndefined();

    const cookies = cookiesOf(res).join(";");
    expect(cookies).toContain("twofa_token=");
    expect(cookies).not.toContain("auth_token=");
  });

  it("still rejects a wrong password before ever mentioning two-factor", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });

  it("leaves an account without two-factor completely unchanged", async () => {
    await prisma.user.deleteMany({ where: { username: "noTwoFactorLogin" } });
    await prisma.user.create({
      data: { username: "noTwoFactorLogin", passwordHash: await hashPassword("password123") },
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "noTwoFactorLogin", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("noTwoFactorLogin");
    expect(cookiesOf(res).join(";")).toContain("auth_token=");
  });

  it("completes the login with a correct code", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: codeFor(SECRET) });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("twoFactorLogin");
    expect(cookiesOf(res).join(";")).toContain("auth_token=");
  });

  it("refuses a wrong code", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: "000000" });

    expect(res.status).toBe(401);
    expect(cookiesOf(res).join(";")).not.toContain("auth_token=");
  });

  it("refuses without the challenge cookie, even with a correct code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .send({ code: codeFor(SECRET) });
    expect(res.status).toBe(401);
  });

  it("accepts a recovery code and spends it", async () => {
    const codes = await generateRecoveryCodes(userId);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const first = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ recoveryCode: codes[0] });
    expect(first.status).toBe(200);

    const login2 = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });
    const second = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login2))
      .send({ recoveryCode: codes[0] });
    expect(second.status).toBe(401);
  });

  it("expires the challenge", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorTokenExpiry: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: codeFor(SECRET) });
    expect(res.status).toBe(401);
  });

  // The bypass this ordering exists to prevent: an account carrying BOTH flags
  // must be asked for the second factor, not handed a change_token on password
  // alone. Without this test the branch order is one careless edit from silently
  // reopening a full account takeover.
  it("asks for the second factor even when a password change is also due", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: true },
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    expect(res.body).toEqual({ requiresTwoFactor: true });
    expect(res.body.requiresPasswordChange).toBeUndefined();

    const cookies = cookiesOf(res).join(";");
    expect(cookies).toContain("twofa_token=");
    expect(cookies).not.toContain("change_token=");
  });

  // The challenge is one login or five failures, not a reusable pass.
  it("burns the challenge once it has been redeemed", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });
    const cookies = cookiesOf(login);

    await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookies)
      .send({ code: codeFor(SECRET) });

    const again = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookies)
      .send({ code: codeFor(SECRET) });
    expect(again.status).toBe(401);
  });

  // Five wrong guesses destroy the challenge outright, so the five-minute
  // window is not an unlimited guessing budget.
  it("destroys the challenge after five wrong codes", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });
    const cookies = cookiesOf(login);

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/2fa/verify")
        .set("Cookie", cookies)
        .send({ code: "000000" });
      expect(res.status).toBe(401);
    }

    // The correct code no longer helps — the challenge is gone.
    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookies)
      .send({ code: codeFor(SECRET) });
    expect(res.status).toBe(401);

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorToken).toBeNull();
  });
});
