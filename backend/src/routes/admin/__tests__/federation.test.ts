import express from "express";
import request from "supertest";
import { generateKeyPairSync } from "crypto";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import { hash } from "../../../services/federation/refusal";
import federation from "../federation";

// The parent admin router applies authenticate + requireAdmin + requireWriteScope.
const app = express();
app.use(express.json());
app.use("/api/v1/admin/federation", federation);
app.use(errorHandler);
const PEER = "https://peer.admin-federation.test";
let rowId: number;

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
});
beforeEach(() => {
  delete process.env.FEDERATION_ENABLED;
  resetIdentityCache();
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: PEER } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

it("turns federation on with a key generated in the UI", async () => {
  const put = await request(app)
    .put("/api/v1/admin/federation")
    .send({ enabled: true, origin: "https://me.admin-federation.test" });
  expect(put.status).toBe(200);
  expect(put.body).toMatchObject({ source: null, fingerprint: null });
  const key = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(key.status).toBe(200);
  expect(key.body).toMatchObject({
    source: "settings",
    enabled: true,
    origin: "https://me.admin-federation.test",
  });
  expect(key.body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
  expect(row.federationPrivateKey).not.toContain("PRIVATE KEY");
});

it("refuses changes while the env override holds the identity", async () => {
  process.env.FEDERATION_ENABLED = "1";
  const res = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("COMPARISON_FEDERATION_ENV");
});

it("pins a peer only when its fingerprint matches its key", async () => {
  const pem = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  const bad = await request(app)
    .post("/api/v1/admin/federation/peers")
    .send({ origin: PEER, publicKey: pem, fingerprint: "0".repeat(64), enabled: true });
  expect(bad.status).toBe(400);
  expect(bad.body.code).toBe("COMPARISON_PEER_KEY_INVALID");
  const good = await request(app)
    .post("/api/v1/admin/federation/peers")
    .send({ origin: PEER, publicKey: pem, fingerprint: hash(pem), enabled: true });
  expect(good.status).toBe(200);
  expect(good.body.peers).toEqual(
    expect.arrayContaining([expect.objectContaining({ origin: PEER, verifiedAt: null })])
  );
});

it("accepts a pasted key whose newlines were flattened to spaces or removed", async () => {
  const pem = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  const flattened = [pem.trim().replaceAll("\n", " "), pem.trim().replaceAll("\n", "")];
  for (const publicKey of flattened) {
    const res = await request(app)
      .post("/api/v1/admin/federation/peers")
      .send({ origin: PEER, publicKey, fingerprint: hash(pem), enabled: true });
    expect(res.status).toBe(200);
  }
  const stored = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
  expect(stored.publicKey).toBe(pem);
});

it("refuses a pasted private key, even one whose public half matches the fingerprint", async () => {
  const PRIVATE_PEER = "https://private.admin-federation.test";
  const pair = generateKeyPairSync("ed25519");
  const pub = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const priv = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  try {
    for (const publicKey of [priv, priv.trim().replaceAll("\n", " ")]) {
      const res = await request(app)
        .post("/api/v1/admin/federation/peers")
        .send({ origin: PRIVATE_PEER, publicKey, fingerprint: hash(pub), enabled: true });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("COMPARISON_PEER_KEY_INVALID");
    }
    expect(await prisma.comparisonPeer.count({ where: { origin: PRIVATE_PEER } })).toBe(0);
  } finally {
    await prisma.comparisonPeer.deleteMany({ where: { origin: PRIVATE_PEER } });
  }
});

it("still refuses text that is not a key after normalising", async () => {
  const res = await request(app)
    .post("/api/v1/admin/federation/peers")
    .send({
      origin: PEER,
      publicKey: "this is not a public key at all, just a sentence long enough to pass",
      fingerprint: "0".repeat(64),
      enabled: true,
    });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("COMPARISON_PEER_KEY_INVALID");
});

it("refuses http origins and ports", async () => {
  for (const origin of ["http://x.example", "https://x.example:8443", "local"]) {
    const res = await request(app).put("/api/v1/admin/federation").send({ enabled: true, origin });
    expect(res.status).toBe(400);
  }
});

it("answers 404 for verify and suspend on an origin that was never pinned", async () => {
  for (const path of ["verify", "suspend"]) {
    const res = await request(app)
      .post(`/api/v1/admin/federation/peers/${path}`)
      .send({ origin: "https://never-pinned.admin-federation.test" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("COMPARISON_PEER_UNKNOWN");
  }
});

it("never returns the private key", async () => {
  await request(app)
    .put("/api/v1/admin/federation")
    .send({ enabled: true, origin: "https://me.admin-federation.test" });
  const res = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY/);
  expect(Object.keys(res.body)).not.toContain("privateKey");
});
