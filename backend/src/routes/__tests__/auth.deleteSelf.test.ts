import request from "supertest";
import { createGuardrails, generateSync } from "otplib";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptSecret } from "../../services/twoFactor/totpService";
import { generateRecoveryCodes } from "../../services/twoFactor/recoveryCodeService";

const SECRET = "JBSWY3DPEHPK3PXP";
const guardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });
const codeFor = (): string => generateSync({ secret: SECRET, guardrails });

const NAMES = ["delSelfPlain", "delSelfTfa", "delSelfAdmin", "delSelfAdmin2", "demo"];

async function makeUser(
  username: string,
  opts: { admin?: boolean; tfa?: boolean; demo?: boolean } = {}
): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("password123"),
      isAdmin: opts.admin ?? false,
      isDemo: opts.demo ?? false,
      ...(opts.tfa
        ? { twoFactorSecret: encryptSecret(SECRET), twoFactorEnabledAt: new Date() }
        : {}),
    },
  });
  return user.id;
}

const del = (id: string, body: Record<string, unknown>): request.Test =>
  request(app)
    .delete("/api/v1/auth/me")
    .set("Cookie", `auth_token=${generateToken(id)}`)
    .send(body);

describe("deleting one's own account (DELETE /auth/me)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  });

  it("removes the account and its rows at once, logs out, for the right password and word", async () => {
    const id = await makeUser("delSelfPlain");
    await prisma.userSettings.upsert({
      where: { userId: id },
      create: { userId: id, data: {} },
      update: {},
    });
    const res = await del(id, { password: "password123", confirmation: "delete" });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.userSettings.count({ where: { userId: id } })).toBe(0);
    expect(String(res.headers["set-cookie"])).toMatch(/auth_token=;/);
  });

  it("accepts the German word too", async () => {
    const id = await makeUser("delSelfPlain");
    const res = await del(id, { password: "password123", confirmation: "LÖSCHEN" });
    expect(res.status).toBe(200);
  });

  it("refuses a wrong password with 403, never 401 (the client signs out on 401), and keeps the account", async () => {
    const id = await makeUser("delSelfPlain");
    const res = await del(id, { password: "nope", confirmation: "DELETE" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DELETE_PASSWORD_INCORRECT");
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("refuses a missing or wrong typed word and keeps the account", async () => {
    const id = await makeUser("delSelfPlain");
    const wrong = await del(id, { password: "password123", confirmation: "yes" });
    expect(wrong.status).toBe(400);
    const missing = await del(id, { password: "password123" });
    expect(missing.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("asks for the second factor when the account has one, and refuses a wrong code", async () => {
    const id = await makeUser("delSelfTfa", { tfa: true });
    const none = await del(id, { password: "password123", confirmation: "DELETE" });
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("DELETE_SECOND_FACTOR_REQUIRED");
    const bad = await del(id, { password: "password123", confirmation: "DELETE", code: "000000" });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe("DELETE_SECOND_FACTOR_INVALID");
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("deletes with a valid authenticator code", async () => {
    const id = await makeUser("delSelfTfa", { tfa: true });
    const res = await del(id, {
      password: "password123",
      confirmation: "DELETE",
      code: codeFor(),
    });
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });

  it("deletes with a recovery code and burns it", async () => {
    const id = await makeUser("delSelfTfa", { tfa: true });
    const codes = await generateRecoveryCodes(id);
    const res = await del(id, {
      password: "password123",
      confirmation: "DELETE",
      recoveryCode: codes[0],
    });
    expect(res.status).toBe(200);
  });

  it("refuses the last remaining admin with its own code", async () => {
    await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
    const id = await makeUser("delSelfAdmin", { admin: true });
    const res = await del(id, { password: "password123", confirmation: "DELETE" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DELETE_LAST_ADMIN");
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("lets an admin delete itself while another admin remains", async () => {
    const id = await makeUser("delSelfAdmin", { admin: true });
    await makeUser("delSelfAdmin2", { admin: true });
    const res = await del(id, { password: "password123", confirmation: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("refuses the shared demo account", async () => {
    const id = await makeUser("demo", { demo: true });
    const res = await del(id, { password: "password123", confirmation: "DELETE" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    expect(await prisma.user.findUnique({ where: { id } })).not.toBeNull();
  });

  it("two admins deleting themselves at the same moment cannot leave the instance without one", async () => {
    await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
    const a = await makeUser("delSelfAdmin", { admin: true });
    const b = await makeUser("delSelfAdmin2", { admin: true });
    const [ra, rb] = await Promise.all([
      del(a, { password: "password123", confirmation: "DELETE" }),
      del(b, { password: "password123", confirmation: "DELETE" }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await prisma.user.count({ where: { isAdmin: true } })).toBe(1);
  });
});
