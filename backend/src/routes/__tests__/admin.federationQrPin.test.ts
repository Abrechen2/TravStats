import request from "supertest";
import { generateKeyPairSync } from "crypto";
import { strToU8, zipSync } from "fflate";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { resetIdentityCache } from "../../services/federation/identity";
import { hash } from "../../services/federation/refusal";
import {
  buildServerQrPayload,
  readServerQrPayload,
} from "../../services/federation/connectionFile";

/** Admin pairing by QR (spec 2026-11-02 §6): the Companion pins a peer from a scanned QR. */
const URL_PEERS = "/api/v1/admin/federation/peers";
const PEER = "https://peer.qr-pin.test";
const ME = "https://me.qr-pin.test";

const pemOf = () =>
  generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const values = (origin = PEER) => {
  const publicKey = pemOf();
  return { origin, publicKey, fingerprint: hash(publicKey) };
};

let adminId: string;
let userId: string;
let adminCookie: string;
let userCookie: string;
let rowId: number;

beforeAll(async () => {
  const stamp = Date.now();
  const admin = await prisma.user.create({
    data: {
      username: `qrpin-admin-${stamp}`,
      passwordHash: await hashPassword("password123"),
      isAdmin: true,
    },
  });
  const user = await prisma.user.create({
    data: { username: `qrpin-user-${stamp}`, passwordHash: await hashPassword("password123") },
  });
  adminId = admin.id;
  userId = user.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  userCookie = `auth_token=${generateToken(user.id)}`;
  rowId = await ensureAdminSettingsRow();
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: true, federationOrigin: ME },
  });
  resetIdentityCache();
  await request(app).post("/api/v1/admin/federation/key").set("Cookie", adminCookie).send({});
});
beforeEach(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: [adminId, userId] } } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  resetIdentityCache();
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  await prisma.$disconnect();
});

const pinQr = (qr: unknown, cookie = adminCookie) =>
  request(app).post(URL_PEERS).set("Cookie", cookie).send({ qr });

describe("QR payload", () => {
  it("round-trips through the parser", () => {
    const v = values();
    expect(readServerQrPayload(buildServerQrPayload(v))).toEqual(v);
    expect(JSON.parse(buildServerQrPayload(v))).toEqual({
      v: 1,
      k: "server",
      u: v.origin,
      key: v.publicKey,
      fp: v.fingerprint,
    });
  });
});

describe("POST /admin/federation/peers {qr}", () => {
  it("refuses a non-admin", async () => {
    const res = await pinQr(buildServerQrPayload(values()), userCookie);
    expect(res.status).toBe(403);
    expect(await prisma.comparisonPeer.count({ where: { origin: PEER } })).toBe(0);
  });

  it("pins from the QR and leaves the peer unverified until verify", async () => {
    const v = values();
    const res = await pinQr(buildServerQrPayload(v));
    expect(res.status).toBe(200);
    expect(res.body.computedFingerprint).toBe(v.fingerprint);
    expect(res.body.peer).toMatchObject({
      origin: PEER,
      fingerprint: v.fingerprint,
      verifiedAt: null,
    });
    const row = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
    expect(row.verifiedAt).toBeNull();
  });

  it("refuses a forged fingerprint, a wrong version, a foreign kind and junk", async () => {
    const v = values();
    const bad = [
      { v: 1, k: "server", u: v.origin, key: v.publicKey, fp: hash(pemOf()) },
      { v: 2, k: "server", u: v.origin, key: v.publicKey, fp: v.fingerprint },
      { v: 1, k: "user", u: v.origin, key: v.publicKey, fp: v.fingerprint },
      { v: 1, k: "server", u: "http://insecure.test", key: v.publicKey, fp: v.fingerprint },
      {
        v: 1,
        k: "server",
        u: v.origin,
        key: "not a key at all, long enough to pass the length floor",
        fp: v.fingerprint,
      },
      { v: 1, k: "server", u: v.origin, key: v.publicKey, fp: v.fingerprint, extra: 1 },
      "{not json",
    ];
    for (const qr of bad) {
      const res = await pinQr(qr);
      expect([400, 422]).toContain(res.status);
    }
    expect(await prisma.comparisonPeer.count({ where: { origin: PEER } })).toBe(0);
  });

  it("refuses a QR describing this server", async () => {
    const res = await pinQr(buildServerQrPayload(values(ME)));
    expect(res.status).toBe(400);
  });

  it("accepts the connection file as base64", async () => {
    const v = values();
    const json = { format: "travstats-federation-connection", version: 1, ...v };
    const zip = Buffer.from(
      zipSync({ "travstats-connection.json": strToU8(JSON.stringify(json)) })
    );
    const res = await request(app)
      .post(URL_PEERS)
      .set("Cookie", adminCookie)
      .send({ connectionFile: zip.toString("base64") });
    expect(res.status).toBe(200);
    expect(res.body.peer.verifiedAt).toBeNull();
  });

  it("works for an admin's PAT with admin scope, not for write scope", async () => {
    const mint = async (scope: "write" | "admin") => {
      const t = await generateApiToken();
      await prisma.apiToken.create({
        data: { userId: adminId, label: scope, lookupHash: t.lookupHash, hash: t.hash, scope },
      });
      return `Bearer ${t.plaintext}`;
    };
    const payload = buildServerQrPayload(values());
    const denied = await request(app)
      .post(URL_PEERS)
      .set("Authorization", await mint("write"))
      .send({ qr: payload });
    expect(denied.status).toBe(403);
    const ok = await request(app)
      .post(URL_PEERS)
      .set("Authorization", await mint("admin"))
      .send({ qr: payload });
    expect(ok.status).toBe(200);
  });
});
