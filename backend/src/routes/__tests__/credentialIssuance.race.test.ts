import crypto from "crypto";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as apiTokens from "../../utils/apiTokens";
import { generatePairingCode } from "../../services/pairing/pairingService";
import { rotateCredentials } from "../../services/revokeUserApiTokens";

/**
 * forgejo#415 (Codex, 06.11.): a token issued concurrently with a password
 * change could be inserted after the revocation and survive it. Each case
 * runs the password change in the exact gap the bug lived in — after the
 * request was authenticated / the code read, before the token row is written —
 * by hooking the token generator, which runs in that gap.
 */
const NAME = "credRaceUser";

describe("a token issued while the password changes does not survive the change (forgejo#415)", () => {
  let userId: string;
  const original = apiTokens.generateApiToken;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: NAME } });
    const u = await prisma.user.create({
      data: { username: NAME, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: NAME } });
    await prisma.$disconnect();
  });

  const changePasswordInTheGap = (): void => {
    jest.spyOn(apiTokens, "generateApiToken").mockImplementationOnce(async () => {
      await rotateCredentials(userId, { passwordHash: await hashPassword("newPassword456") });
      return original();
    });
  };

  const liveTokens = (): Promise<number> =>
    prisma.apiToken.count({ where: { userId, revokedAt: null } });

  it("a PAT whose session was authenticated before the change is refused, not left live", async () => {
    changePasswordInTheGap();
    const res = await request(app)
      .post("/api/v1/settings/tokens")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ label: "race", scope: "read" });
    expect(res.status).toBe(401);
    expect(await liveTokens()).toBe(0);
  });

  it("a pairing claim racing the change mints no live device token", async () => {
    const { code } = await generatePairingCode(userId);
    changePasswordInTheGap();
    const res = await request(app)
      .post("/api/v1/pairing/claim")
      .send({ code, deviceName: "Phone", deviceId: "dev-race-1", platform: "ios" });
    expect(res.status).toBe(400);
    expect(await liveTokens()).toBe(0);
  });

  it("a pairing code minted under a session older than the change is refused", async () => {
    await rotateCredentials(userId, { passwordHash: await hashPassword("newPassword456") });
    await expect(generatePairingCode(userId, 0)).rejects.toMatchObject({ statusCode: 401 });
    expect(await prisma.pairingCode.count({ where: { userId } })).toBe(0);
  });

  it("two claims of different codes for one device leave one live token for it", async () => {
    const a = await generatePairingCode(userId);
    const b = await generatePairingCode(userId);
    const claim = (code: string) =>
      request(app)
        .post("/api/v1/pairing/claim")
        .send({ code, deviceName: "Phone", deviceId: "dev-same", platform: "ios" });
    const [ra, rb] = await Promise.all([claim(a.code), claim(b.code)]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(
      await prisma.apiToken.count({ where: { userId, deviceId: "dev-same", revokedAt: null } })
    ).toBe(1);
  });

  it("one reset link used twice at once resets the password once", async () => {
    const token = "race-" + crypto.randomBytes(8).toString("hex");
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: crypto.createHash("sha256").update(token).digest("hex"),
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const reset = (newPassword: string) =>
      request(app).post("/api/v1/auth/reset-password").send({ token, newPassword });
    const results = await Promise.all([reset("firstPass1234"), reset("secondPass1234")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.sessionEpoch).toBe(1);
  });

  it("still issues normally when nothing races", async () => {
    const res = await request(app)
      .post("/api/v1/settings/tokens")
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .send({ label: "calm", scope: "read" });
    expect(res.status).toBe(201);
    const { code } = await generatePairingCode(userId, 0);
    const claim = await request(app)
      .post("/api/v1/pairing/claim")
      .send({ code, deviceName: "Phone", deviceId: "dev-calm-1", platform: "ios" });
    expect(claim.status).toBe(201);
    expect(await liveTokens()).toBe(2);
  });
});
