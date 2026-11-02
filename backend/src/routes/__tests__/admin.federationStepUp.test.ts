import request from "supertest";
import { generateKeyPairSync } from "crypto";
import { generateSync } from "otplib";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { resetIdentityCache } from "../../services/federation/identity";
import { hash } from "../../services/federation/refusal";
import { buildServerQrPayload } from "../../services/federation/connectionFile";
import { encryptSecret, generateSecret } from "../../services/twoFactor/totpService";
import { resetStepUpFailures, STEP_UP_MAX_FAILURES } from "../../services/auth/adminStepUp";

/** Admin step-up for a write-scope Companion token (spec 2026-11-02 §6). */
const PEERS = "/api/v1/admin/federation/peers";
const PEER = "https://peer.step-up.test";
const ME = "https://me.step-up.test";
const PASSWORD = "correct-horse-1";

const qr = () => {
  const publicKey = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  return buildServerQrPayload({ origin: PEER, publicKey, fingerprint: hash(publicKey) });
};

let adminId: string;
let plainId: string;
let tfaId: string;
let rowId: number;
const created: string[] = [];

async function mint(userId: string, scope: "write" | "admin" | "read") {
  const t = await generateApiToken();
  await prisma.apiToken.create({
    data: { userId, label: scope, lookupHash: t.lookupHash, hash: t.hash, scope },
  });
  return `Bearer ${t.plaintext}`;
}
async function mkUser(name: string, isAdmin: boolean, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: {
      username: `stepup-${name}-${Date.now()}`,
      passwordHash: await hashPassword(PASSWORD),
      isAdmin,
      ...extra,
    },
  });
  created.push(u.id);
  return u;
}

let tfaSecret: string;
beforeAll(async () => {
  tfaSecret = generateSecret();
  adminId = (await mkUser("admin", true)).id;
  plainId = (await mkUser("plain", false)).id;
  tfaId = (
    await mkUser("tfa", true, {
      twoFactorSecret: encryptSecret(tfaSecret),
      twoFactorEnabledAt: new Date(),
    })
  ).id;
  rowId = await ensureAdminSettingsRow();
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: true, federationOrigin: ME },
  });
  resetIdentityCache();
  await request(app)
    .post("/api/v1/admin/federation/key")
    .set("Cookie", `auth_token=${generateToken(adminId)}`)
    .send({});
});
beforeEach(async () => {
  resetStepUpFailures();
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: created } } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  resetIdentityCache();
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

const post = (path: string, auth: string, body: object) =>
  request(app).post(path).set("Authorization", auth).send(body);
const pinned = async () => prisma.comparisonPeer.count({ where: { origin: PEER } });

describe("admin step-up on the federation pin calls", () => {
  it("pins with a write PAT plus the admin's password", async () => {
    const res = await post(PEERS, await mint(adminId, "write"), { qr: qr(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await pinned()).toBe(1);
  });

  it("refuses a wrong password with ADMIN_STEP_UP_FAILED and moves the lockout counter", async () => {
    const auth = await mint(adminId, "write");
    for (let i = 0; i < STEP_UP_MAX_FAILURES; i++) {
      const res = await post(PEERS, auth, { qr: qr(), password: "nope" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("ADMIN_STEP_UP_FAILED");
    }
    // Locked now: even the right password is refused until the window passes.
    const locked = await post(PEERS, auth, { qr: qr(), password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("ADMIN_STEP_UP_LOCKED");
    expect(await pinned()).toBe(0);
  });

  it("asks for the TOTP when two-factor is on and none came", async () => {
    const res = await post(PEERS, await mint(tfaId, "write"), { qr: qr(), password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_STEP_UP_TOTP_REQUIRED");
    expect(await pinned()).toBe(0);
  });

  it("refuses a wrong TOTP with ADMIN_STEP_UP_FAILED and accepts the right one", async () => {
    const auth = await mint(tfaId, "write");
    const wrong = await post(PEERS, auth, { qr: qr(), password: PASSWORD, totp: "000000" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("ADMIN_STEP_UP_FAILED");
    const ok = await post(PEERS, auth, {
      qr: qr(),
      password: PASSWORD,
      totp: generateSync({ secret: tfaSecret }),
    });
    expect(ok.status).toBe(200);
  });

  it("still refuses a non-admin who sends a password", async () => {
    const res = await post(PEERS, await mint(plainId, "write"), { qr: qr(), password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    expect(await pinned()).toBe(0);
  });

  it("still refuses a write PAT without a password", async () => {
    const res = await post(PEERS, await mint(adminId, "write"), { qr: qr() });
    expect(res.status).toBe(403);
    expect(await pinned()).toBe(0);
  });

  it("refuses an account with no usable password (passkey-only) with ADMIN_STEP_UP_FAILED", async () => {
    const u = await mkUser("passkey", true);
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: "!" } });
    const res = await post(PEERS, await mint(u.id, "write"), { qr: qr(), password: "!" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ADMIN_STEP_UP_FAILED");
  });

  it("does not accept a step-up body on any other admin route", async () => {
    const auth = await mint(adminId, "write");
    for (const path of [
      "/api/v1/admin/federation/key",
      "/api/v1/admin/federation/peers/other",
      "/api/v1/admin/users",
    ]) {
      const res = await post(path, auth, { password: PASSWORD });
      expect(res.status).toBe(403);
    }
    const get = await request(app)
      .get("/api/v1/admin/federation")
      .set("Authorization", auth)
      .query({ password: PASSWORD });
    expect(get.status).toBe(403);
  });

  it("leaves an admin-scope PAT and a browser session working without step-up", async () => {
    const viaPat = await post(PEERS, await mint(adminId, "admin"), { qr: qr() });
    expect(viaPat.status).toBe(200);
    const viaSession = await request(app)
      .post(PEERS)
      .set("Cookie", `auth_token=${generateToken(adminId)}`)
      .send({ qr: qr() });
    expect(viaSession.status).toBe(200);
  });

  it("covers verify and suspend with the same step-up", async () => {
    await prisma.comparisonPeer.create({
      data: { origin: PEER, publicKey: "k", enabled: true },
    });
    const auth = await mint(adminId, "write");
    const denied = await post(`${PEERS}/suspend`, auth, { origin: PEER });
    expect(denied.status).toBe(403);
    const wrong = await post(`${PEERS}/suspend`, auth, { origin: PEER, password: "nope" });
    expect(wrong.body.code).toBe("ADMIN_STEP_UP_FAILED");
    const ok = await post(`${PEERS}/suspend`, auth, { origin: PEER, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ suspended: true });
    // verify reaches its handler (the peer is not reachable in a test: 502, not 403).
    const verify = await post(`${PEERS}/verify`, auth, { origin: PEER, password: PASSWORD });
    expect(verify.status).not.toBe(403);
    const verifyDenied = await post(`${PEERS}/verify`, auth, { origin: PEER });
    expect(verifyDenied.status).toBe(403);
  });
});
