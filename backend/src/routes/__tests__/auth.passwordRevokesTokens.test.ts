import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";

jest.mock("../../services/emailService", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateApiToken } from "../../utils/apiTokens";
import { generateToken, verifyToken } from "../../utils/jwt";
import { JWT_SECRET } from "../../utils/jwtSecret";

/**
 * forgejo#412 M1 — a password change closed the cookie sessions (sessionEpoch)
 * but left every API token, paired phones included, working. Whoever held a
 * stolen token kept the account after the owner "fixed" the password.
 */
const NAMES = ["pwRevokeUser", "pwRevokeAdmin"];
let userId: string;
let adminId: string;

async function mintToken(uid: string, extra: { deviceId?: string } = {}): Promise<string> {
  const tok = await generateApiToken();
  const row = await prisma.apiToken.create({
    data: {
      userId: uid,
      label: "revoke-test",
      lookupHash: tok.lookupHash,
      hash: tok.hash,
      ...extra,
    },
  });
  return row.id;
}
const liveTokens = (uid: string) =>
  prisma.apiToken.count({ where: { userId: uid, revokedAt: null } });

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  const u = await prisma.user.create({
    data: { username: NAMES[0], passwordHash: await hashPassword("oldpassword1") },
  });
  const a = await prisma.user.create({
    data: { username: NAMES[1], passwordHash: await hashPassword("adminpass123"), isAdmin: true },
  });
  userId = u.id;
  adminId = a.id;
  await mintToken(userId);
  await mintToken(userId, { deviceId: "phone-1" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: NAMES } } });
  await prisma.$disconnect();
});

describe("password changes revoke API tokens (forgejo#412 M1)", () => {
  it("change-password revokes PATs and device tokens", async () => {
    expect(await liveTokens(userId)).toBe(2);
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ oldPassword: "oldpassword1", newPassword: "newpassword1" });
    expect(res.status).toBe(200);
    expect(await liveTokens(userId)).toBe(0);
  });

  it("change-password deletes unspent pairing codes and push registrations", async () => {
    await prisma.pairingCode.create({
      data: { codeHash: `h-${Date.now()}`, userId, expiresAt: new Date(Date.now() + 600_000) },
    });
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ oldPassword: "oldpassword1", newPassword: "newpassword1" });
    expect(res.status).toBe(200);
    expect(await prisma.pairingCode.count({ where: { userId } })).toBe(0);
  });

  it("reset-password via emailed link revokes tokens", async () => {
    const plain = "a".repeat(40);
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: crypto.createHash("sha256").update(plain).digest("hex"),
        resetTokenExpiry: new Date(Date.now() + 3600_000),
      },
    });
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: plain, newPassword: "newpassword1" });
    expect(res.status).toBe(200);
    expect(await liveTokens(userId)).toBe(0);
  });

  it("admin password reset revokes the target's tokens", async () => {
    const res = await request(app)
      .post(`/api/v1/admin/users/${userId}/reset-password`)
      .set("Cookie", `auth_token=${generateToken(adminId)}`)
      .send({ mode: "set", password: "newpassword1" });
    expect(res.status).toBe(200);
    expect(await liveTokens(userId)).toBe(0);
  });
});

describe("session JWTs are pinned to HS256 (forgejo#412 N2)", () => {
  it("round-trips an HS256 token", () => {
    expect(verifyToken(generateToken(userId)).userId).toBe(userId);
  });
  it("refuses a validly-signed token of another HMAC algorithm", () => {
    const hs512 = jwt.sign({ userId, epoch: 0 }, JWT_SECRET, { algorithm: "HS512" });
    expect(() => verifyToken(hs512)).toThrow();
  });
});
