import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync } from "crypto";
import { errorHandler } from "../../middleware/errorHandler";
import { prisma } from "../../db";
import identityRoutes from "../federationIdentity";
import { loadIdentity } from "../../services/federation/identity";
import {
  pauseFederation,
  setFederationIdentity,
} from "../../services/federation/__tests__/identityFixture";
import { fingerprintOfRaw, pemFromRawPublicKey } from "../../services/federation/rawKey";

const app = express();
app.use("/api/v1/federation", identityRoutes);
app.use(errorHandler);

const ORIGIN = "https://self.identity-route.test";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-route-"));
let restore: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  fs.writeFileSync(path.join(dir, "k.pem"), key.export({ type: "pkcs8", format: "pem" }));
  restore = await setFederationIdentity(ORIGIN, path.join(dir, "k.pem"));
});
afterAll(async () => {
  await restore();
  await prisma.$disconnect();
});

it("answers 404 while federation is off", async () => {
  const resume = await pauseFederation();
  try {
    const res = await request(app).get("/api/v1/federation/identity");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FEDERATION_OFF");
  } finally {
    await resume();
  }
});

it("answers origin, key and fingerprint when on", async () => {
  const res = await request(app).get("/api/v1/federation/identity");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ origin: ORIGIN, protocolVersions: expect.any(Array) });
  expect(res.body.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(pemFromRawPublicKey(res.body.publicKey)).toContain("BEGIN PUBLIC KEY");
});

it("the fingerprint matches identity.ts", async () => {
  const res = await request(app).get("/api/v1/federation/identity");
  expect(res.body.fingerprint).toBe((await loadIdentity()).fingerprint);
  expect(fingerprintOfRaw(res.body.publicKey)).toBe(res.body.fingerprint);
});
