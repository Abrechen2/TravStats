import {
  pauseFederation,
  setFederationIdentity,
} from "../../services/federation/__tests__/identityFixture";
/**
 * The trip-share peer route (spec 2026-10-20, phase F-S4a): off is absent, it reads only envelope
 * version 2 with purpose `trip-share/1`, and the comparison route refuses that purpose in turn.
 * F-S4c: each kind is held to its own body budget, and a group message that fails its schema is
 * answered under signature with the field, not with a shrug.
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
import { BODY_BUDGET, MAX_BODY, MAX_LARGE_BODY } from "../../services/sharing/federation/transport";
import { ENTRY_SHAPES } from "../../services/sharing/federation/wire/shapes";
import { MAX_ENTRIES_PER_MESSAGE } from "../../schemas/tripSharePeer";
import { peerBodyParser } from "../../middleware/peerBody";
import { PEER_PREAUTH_HEADER, preAuthBytes } from "../../services/federation/security";
import tripSharePeer from "../tripSharePeer";
import comparisonPeer from "../comparisonPeer";

const LOCAL = "https://local.trip-peer-route.test";
const REMOTE = "https://remote.trip-peer-route.test";
const remote = generateKeyPairSync("ed25519");
const local = generateKeyPairSync("ed25519");
const localPublic = local.publicKey.export({ type: "spki", format: "pem" }).toString();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-peer-route-"));
const app = express();
app.use(express.json({ limit: "32mb" }));
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

let restoreIdentity: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  fs.writeFileSync(
    path.join(dir, "local.key"),
    local.privateKey.export({ type: "pkcs8", format: "pem" })
  );
  restoreIdentity = await setFederationIdentity(LOCAL, path.join(dir, "local.key"));
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
  await restoreIdentity();
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
  ])(
    "with federation on and %s, serves the ping and user connections only (spec 2026-11-08 §11.7) and refuses every trip message",
    async (_name, flags) => {
      await setTripFlags(flags);
      const pinged = await request(app)
        .post("/api/v1/trip-share-peer")
        .send(signed(ping(), "trip-share/1"));
      expect(pinged.status).toBe(200);
      const trip = JSON.stringify({
        kind: "offer",
        messageId: randomUUID(),
        sentAt: new Date().toISOString(),
      });
      const packet = signed(trip, "trip-share/1");
      const refused = await request(app).post("/api/v1/trip-share-peer").send(packet);
      expect(refused.status).toBe(403);
      expect(await nonceRow(packet)).toBeNull();
    }
  );

  it("answers the plain 404 when federation itself is off, before reading the packet", async () => {
    await setTripFlags({ betaFeaturesEnabled: false });
    const resume = await pauseFederation();
    try {
      const packet = signed(ping(), "trip-share/1");
      const res = await request(app).post("/api/v1/trip-share-peer").send(packet);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
      expect(await nonceRow(packet)).toBeNull();
    } finally {
      await resume();
    }
  });

  it("answers 404 when the server has no identity", async () => {
    const resume = await pauseFederation();
    try {
      const res = await request(app)
        .post("/api/v1/trip-share-peer")
        .send(signed(ping(), "trip-share/1"));
      expect(res.status).toBe(404);
    } finally {
      await resume();
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
    expect(JSON.parse(reply.body)).toEqual({
      tripShare: [1],
      features: [
        "resync",
        "entries-up",
        "nudge",
        "directory",
        "stats",
        "connections",
        "plans",
        "achievements",
      ],
    });
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

it("refuses a packet above the largest budget before checking its signature", async () => {
  const packet = signed(
    JSON.stringify({ kind: "plan-doc-put", pad: "x".repeat(MAX_LARGE_BODY) }),
    "trip-share/1"
  );
  const res = await request(app)
    .post("/api/v1/trip-share-peer")
    .send({ ...packet, signature: "not-a-signature" });
  expect(res.status).toBe(403);
  refusedAs("packet-too-large", "trip_share_peer_refused");
});

it("reads a body above the ordinary cap only from an admitted origin, and refuses a stranger's before parsing it", async () => {
  const body = JSON.stringify({ kind: "plan-doc-put", pad: "x".repeat(MAX_BODY + 10) });
  const stranger = {
    ...signed(body, "trip-share/1"),
    origin: "https://stranger.trip-peer-route.test",
  };
  const res = await request(app).post("/api/v1/trip-share-peer").send(stranger);
  expect(res.status).toBe(403);
  refusedAs("packet-too-large", "trip_share_peer_refused");
  expect(await nonceRow(stranger)).toBeNull();
  // The admitted origin passes the size gate (its body then fails on the budget of its kind).
  warn.mockClear();
  const admitted = signed(body, "trip-share/1");
  await prisma.comparisonPeer.update({
    where: { origin: REMOTE },
    data: { verifiedAt: new Date() },
  });
  try {
    await request(app).post("/api/v1/trip-share-peer").send(admitted);
  } finally {
    await prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { verifiedAt: null } });
  }
  expect(warn).not.toHaveBeenCalledWith(
    expect.objectContaining({ kind: "packet-too-large" }),
    expect.any(String)
  );
});

describe("the body parser before the signature", () => {
  // The route's own parser caps at 1 MB here; only the peer parser may read more.
  const capped = express();
  capped.use("/x", peerBodyParser, express.json({ limit: "1mb" }), (req, res) => {
    res.json({ bytes: JSON.stringify(req.body).length });
  });
  const big = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) });
  const header = (
    over: { origin?: string; length?: number; time?: number; key?: typeof remote } = {}
  ) => {
    const time = over.time ?? Date.now();
    const bytes = preAuthBytes(
      over.origin ?? REMOTE,
      LOCAL,
      time,
      over.length ?? Buffer.byteLength(big)
    );
    return `${over.origin ?? REMOTE} ${time} ${sign(null, bytes, (over.key ?? remote).privateKey).toString("base64")}`;
  };
  const post = (value?: string) => {
    const r = request(capped).post("/x").set("Content-Type", "application/json");
    return (value ? r.set(PEER_PREAUTH_HEADER, value) : r).send(big);
  };
  beforeEach(() =>
    prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { verifiedAt: new Date() } })
  );
  afterEach(() =>
    prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { verifiedAt: null } })
  );

  it("reads a large body from an admitted peer that proves itself in the header", async () => {
    expect((await post(header())).status).toBe(200);
  });

  it.each([
    ["no header", () => undefined],
    ["a header signed by another key", () => header({ key: generateKeyPairSync("ed25519") })],
    ["a header for another length", () => header({ length: 10 })],
    ["a header older than the window", () => header({ time: Date.now() - 5 * 60_000 })],
    [
      "an origin nobody admitted",
      () => header({ origin: "https://stranger.trip-peer-route.test" }),
    ],
  ])("does not read a large body for %s", async (_name, make) => {
    expect((await post(make())).status).toBe(413);
  });

  it("does not read it from a peer the admin has not verified", async () => {
    await prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { verifiedAt: null } });
    expect((await post(header())).status).toBe(413);
  });
});

it.each([
  ["a ping", "ping", BODY_BUDGET.ping],
  ["an offer answer", "offer-answer", BODY_BUDGET["offer-answer"]],
  ["an offer", "offer", BODY_BUDGET.offer],
])("holds %s to its own budget", async (_name, kind, budget) => {
  const res = await request(app)
    .post("/api/v1/trip-share-peer")
    .send(signed(JSON.stringify({ kind, pad: "x".repeat(budget) }), "trip-share/1"));
  expect(res.status).toBe(403);
  refusedAs("packet-too-large", "trip_share_peer_refused");
});

describe("group messages from a verified peer", () => {
  const header = (kind: string) => ({
    kind,
    messageId: randomUUID(),
    sentAt: new Date().toISOString(),
    groupRef: randomUUID(),
    seq: 1,
  });
  const answerOf = async (body: object) => {
    const res = await request(app)
      .post("/api/v1/trip-share-peer")
      .send(signed(JSON.stringify(body), "trip-share/1"));
    expect(res.status).toBe(200);
    return JSON.parse(
      verifyEnvelope(res.body, localPublic, REMOTE, Date.now(), TRIP_SHARE_ACCEPTS).body
    );
  };
  beforeAll(async () => {
    await prisma.comparisonPeer.update({
      where: { origin: REMOTE },
      data: { verifiedAt: new Date() },
    });
  });
  afterAll(async () => {
    await prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { verifiedAt: null } });
  });

  const validStop = () => ({
    entity: "stop",
    shareKey: randomUUID(),
    facts: {
      ...Object.fromEntries(Object.keys(ENTRY_SHAPES.stop).map((k) => [k, null])),
      orderIdx: 0,
      title: "x",
    },
  });

  it("answers entries for a group it does not hold as not-member, under signature", async () => {
    expect(
      await answerOf({
        ...header("entries"),
        from: randomUUID(),
        entries: [validStop()],
        authors: [],
      })
    ).toEqual({ kind: "ack", rejected: "not-member" });
  });

  it("answers a group message that fails its schema with the field", async () => {
    const stop = {
      entity: "stop",
      shareKey: randomUUID(),
      facts: { title: "x", seatNumber: "12A" },
    };
    expect(
      await answerOf({ ...header("entries"), from: randomUUID(), entries: [stop] })
    ).toMatchObject({
      kind: "ack",
      rejected: "schema",
      field: expect.stringMatching(/^entries\.0/),
    });
  });

  it(`refuses more than ${MAX_ENTRIES_PER_MESSAGE} entries in one message`, async () => {
    expect(
      await answerOf({
        ...header("entries"),
        from: randomUUID(),
        entries: Array.from({ length: MAX_ENTRIES_PER_MESSAGE + 1 }, validStop),
      })
    ).toMatchObject({ kind: "ack", rejected: "schema", field: "entries" });
  });
});
