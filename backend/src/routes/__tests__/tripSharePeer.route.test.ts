/**
 * The trip-share peer route (spec 2026-10-20, phase F-S4a): off is absent, it reads only envelope
 * version 2 with purpose `trip-share/1`, and the comparison route refuses that purpose in turn.
 */
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "crypto";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { hash } from "../../services/federation/refusal";
import { resetIdentityCache } from "../../services/federation/identity";
import {
  TRIP_SHARE_ACCEPTS,
  verifyEnvelope,
  type EnvelopePurpose,
} from "../../services/federation/envelope";
import { setTripFlags } from "../../services/sharing/federation/__tests__/instanceFlags";
import tripSharePeer from "../tripSharePeer";
import comparisonPeer from "../comparisonPeer";

const LOCAL = "https://local.trip-peer-route.test";
const REMOTE = "https://remote.trip-peer-route.test";
const remote = generateKeyPairSync("ed25519");
const local = generateKeyPairSync("ed25519");
const localPublic = local.publicKey.export({ type: "spki", format: "pem" }).toString();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-peer-route-"));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1/trip-share-peer", tripSharePeer);
app.use("/api/v1/comparison-peer", comparisonPeer);

const ping = () =>
  JSON.stringify({ kind: "ping", messageId: randomUUID(), sentAt: new Date().toISOString() });

/** A packet from REMOTE, signed as version 1 (no purpose) or version 2 with `purpose`. */
function signed(body: string, purpose?: EnvelopePurpose) {
  const fields = {
    origin: REMOTE,
    destination: LOCAL,
    nonce: randomBytes(32).toString("hex"),
    time: Date.now(),
    body,
  };
  const unsigned = purpose ? { v: 2, purpose, ...fields } : fields;
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(JSON.stringify(unsigned)), remote.privateKey).toString(
      "base64"
    ),
  };
}
const nonceRow = (m: { nonce: string }) =>
  prisma.comparisonNonce.findUnique({ where: { id: hash(REMOTE + m.nonce) } });
let flagsBefore: Awaited<ReturnType<typeof setTripFlags>>;
let warn: jest.SpyInstance;

beforeAll(async () => {
  fs.writeFileSync(
    path.join(dir, "local.key"),
    local.privateKey.export({ type: "pkcs8", format: "pem" })
  );
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = LOCAL;
  process.env.FEDERATION_KEY_FILE = path.join(dir, "local.key");
  resetIdentityCache();
  await prisma.comparisonPeer.upsert({
    where: { origin: REMOTE },
    create: {
      origin: REMOTE,
      publicKey: remote.publicKey.export({ type: "spki", format: "pem" }).toString(),
      enabled: true,
    },
    update: { enabled: true, verifiedAt: null },
  });
  flagsBefore = await setTripFlags({ betaFeaturesEnabled: true, tripFederationEnabled: true });
});
beforeEach(async () => {
  await setTripFlags({ betaFeaturesEnabled: true, tripFederationEnabled: true });
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined as never);
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  await setTripFlags(flagsBefore);
  await prisma.comparisonPeer.delete({ where: { origin: REMOTE } });
  for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"])
    delete process.env[key];
  resetIdentityCache();
  fs.rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

const refusedAs = (kind: string, operation: string) =>
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ operation, kind }),
    expect.any(String)
  );

describe("off is absent", () => {
  it.each([
    ["the beta switch is off", { betaFeaturesEnabled: false }],
    ["the admin's trip-sharing switch is off", { tripFederationEnabled: false }],
  ])("answers the plain 404 when %s, before reading the packet", async (_name, flags) => {
    await setTripFlags(flags);
    const packet = signed(ping(), "trip-share/1");
    const res = await request(app).post("/api/v1/trip-share-peer").send(packet);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(await nonceRow(packet)).toBeNull();
  });

  it("answers 404 when the server has no identity", async () => {
    delete process.env.FEDERATION_ENABLED;
    resetIdentityCache();
    try {
      const res = await request(app)
        .post("/api/v1/trip-share-peer")
        .send(signed(ping(), "trip-share/1"));
      expect(res.status).toBe(404);
    } finally {
      process.env.FEDERATION_ENABLED = "1";
      resetIdentityCache();
    }
  });
});

describe("ping", () => {
  it("answers with the served versions, signed as trip-share/1 for the asking server", async () => {
    const packet = signed(ping(), "trip-share/1");
    const res = await request(app).post("/api/v1/trip-share-peer").send(packet);
    expect(res.status).toBe(200);
    const reply = verifyEnvelope(res.body, localPublic, REMOTE, Date.now(), TRIP_SHARE_ACCEPTS);
    expect(reply.nonce).toBe(packet.nonce);
    expect(JSON.parse(reply.body)).toEqual({ tripShare: [1] });
  });
});

describe("cross-purpose refusal", () => {
  it.each([
    ["version 1 (what the comparison protocol sends)", undefined],
    ["version 2 for comparison/1", "comparison/1" as const],
  ])("the trip route refuses a validly signed %s", async (_name, purpose) => {
    const res = await request(app).post("/api/v1/trip-share-peer").send(signed(ping(), purpose));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "TRIP_SHARE_REFUSED" });
    refusedAs("wrong-purpose", "trip_share_peer_refused");
  });

  it("the comparison route refuses a validly signed trip-share/1 packet", async () => {
    const res = await request(app)
      .post("/api/v1/comparison-peer")
      .send(signed('{"action":"ping"}', "trip-share/1"));
    expect(res.status).toBe(403);
    refusedAs("wrong-purpose", "comparison_peer_refused");
  });

  it("the comparison route still reads version 1 and version 2 comparison/1, and answers in kind", async () => {
    const v1 = await request(app).post("/api/v1/comparison-peer").send(signed('{"action":"ping"}'));
    expect(v1.status).toBe(200);
    expect(v1.body.v).toBeUndefined();
    const v2 = await request(app)
      .post("/api/v1/comparison-peer")
      .send(signed('{"action":"ping"}', "comparison/1"));
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ v: 2, purpose: "comparison/1" });
  });

  it("a comparison body in a trip-share envelope does not parse as a trip message", async () => {
    const res = await request(app)
      .post("/api/v1/trip-share-peer")
      .send(signed('{"action":"ping"}', "trip-share/1"));
    expect(res.status).toBe(403);
    refusedAs("malformed", "trip_share_peer_refused");
  });
});

it("refuses a non-ping message from an admitted but unverified peer and keeps no nonce", async () => {
  const packet = signed(
    JSON.stringify({
      kind: "invite-claim",
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      code: "a".repeat(64),
      channel: randomUUID(),
      username: "ben",
      displayName: "Ben",
    }),
    "trip-share/1"
  );
  const res = await request(app).post("/api/v1/trip-share-peer").send(packet);
  expect(res.status).toBe(403);
  refusedAs("unverified-peer", "trip_share_peer_refused");
  expect(await nonceRow(packet)).toBeNull();
});

it("refuses an oversized packet before checking its signature", async () => {
  const res = await request(app)
    .post("/api/v1/trip-share-peer")
    .send(signed(JSON.stringify({ kind: "ping", pad: "x".repeat(9_000) }), "trip-share/1"));
  expect(res.status).toBe(403);
  refusedAs("packet-too-large", "trip_share_peer_refused");
});
