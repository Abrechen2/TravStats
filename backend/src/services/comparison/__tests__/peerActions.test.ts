import { setFederationIdentity } from "../../federation/__tests__/identityFixture";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { getInstanceSettings } from "../../instanceSettingsService";
import { loadVisibleDomains } from "../../domainVisibility";
import { hash } from "../../federation/refusal";
import { resetIdentityCache } from "../../federation/identity";
import { LEADERBOARD_METRICS } from "../../../shared/comparisonMetrics";
import peer from "../../../routes/comparisonPeer";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const LOCAL = "https://local.lb-peer.test";
const REMOTE = "https://remote.lb-peer.test";
const OTHER = "https://other.lb-peer.test";
const keys = {
  local: generateKeyPairSync("ed25519"),
  remote: generateKeyPairSync("ed25519"),
  other: generateKeyPairSync("ed25519"),
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-peer-"));
const app = express();
app.use(express.json());
app.use("/api/v1/comparison-peer", peer);
let ownerId: string;
// The route logs every refused packet by design; tests that care read the spy.
let warn: jest.SpyInstance;

function packet(from: "remote" | "other", body: unknown) {
  const unsigned = {
    origin: from === "remote" ? REMOTE : OTHER,
    destination: LOCAL,
    nonce: randomBytes(32).toString("hex"),
    time: Date.now(),
    body: JSON.stringify(body),
  };
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned)), keys[from].privateKey);
  return { ...unsigned, signature: signature.toString("base64") };
}
async function send(from: "remote" | "other", body: unknown) {
  const res = await request(app).post("/api/v1/comparison-peer").send(packet(from, body));
  return { status: res.status, data: res.status === 200 ? JSON.parse(res.body.body) : null };
}
async function invite(userId = ownerId, expiresAt = new Date(Date.now() + 3_600_000)) {
  const code = randomBytes(32).toString("hex");
  await prisma.leaderboardInvite.create({ data: { hash: hash(code), userId, expiresAt } });
  return code;
}
async function claimed(username: string): Promise<string> {
  const reply = await send("remote", {
    action: "lb-claim",
    code: await invite(),
    username,
    displayName: username,
  });
  return reply.data.channel as string;
}
async function share(channel: string, scope: unknown, status = "accepted") {
  await prisma.leaderboardConsent.updateMany({
    where: { remote: { channel } },
    data: { status, scope: scope as never, decidedAt: new Date() },
  });
}
const ferryScope = (year: number | null) => ({ groups: ["trips"], domains: ["ferry"], year });

let restoreIdentity: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  fs.writeFileSync(
    path.join(dir, "local.key"),
    keys.local.privateKey.export({ type: "pkcs8", format: "pem" })
  );
  restoreIdentity = await setFederationIdentity(LOCAL, path.join(dir, "local.key"));
  resetIdentityCache();
  for (const [origin, pair] of [
    [REMOTE, keys.remote],
    [OTHER, keys.other],
  ] as const) {
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    await prisma.comparisonPeer.upsert({
      where: { origin },
      create: { origin, publicKey, enabled: true, verifiedAt: new Date() },
      update: { publicKey, enabled: true, verifiedAt: new Date() },
    });
  }
  ownerId = (
    await prisma.user.create({
      data: {
        username: `lb-owner-${randomUUID().slice(0, 8)}`,
        passwordHash: "test-only",
        firstName: "Anna",
      },
    })
  ).id;
});
beforeEach(() => {
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { in: [REMOTE, OTHER] } } });
  await prisma.user.delete({ where: { id: ownerId } });
  await restoreIdentity();
  fs.rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

it("advertises the snapshot versions it serves in the ping", async () => {
  expect((await send("remote", { action: "ping" })).data).toEqual({
    ready: true,
    leaderboard: [1],
  });
});

it("redeems an invitation once and asks the inviter before anything is shared", async () => {
  const code = await invite();
  const first = await send("remote", {
    action: "lb-claim",
    code,
    username: "ben",
    displayName: "Ben B",
  });
  expect(first.data).toMatchObject({ accepted: true, displayName: "Anna" });
  const remote = await prisma.leaderboardRemote.findUniqueOrThrow({
    where: { origin_channel: { origin: REMOTE, channel: first.data.channel } },
    include: { consents: true },
  });
  expect(remote).toMatchObject({ userId: ownerId, username: "ben", displayName: "Ben B" });
  expect(remote.consents.map((c) => [c.status, c.scope, c.decidedAt])).toEqual([
    ["pending", null, null],
  ]);
  const again = await send("remote", {
    action: "lb-claim",
    code,
    username: "eve",
    displayName: "Eve",
  });
  expect(again.data).toEqual({ accepted: false });
});

it("refuses an expired invitation and one whose inviter is deactivated", async () => {
  const expired = await invite(ownerId, new Date(Date.now() - 1000));
  const claim = (code: string) =>
    send("remote", { action: "lb-claim", code, username: "zed", displayName: "Zed" });
  expect((await claim(expired)).data).toEqual({ accepted: false });
  const code = await invite();
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
  const reply = await claim(code);
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
  expect(reply.data).toEqual({ accepted: false });
  expect(await prisma.leaderboardRemote.count({ where: { username: "zed" } })).toBe(0);
});

it("serves totals only after the owner accepted, and only in a version the asker reads", async () => {
  const channel = await claimed("cleo");
  const ask = (accept: number[], year: number | null = null) =>
    send("remote", { action: "aggregate", channel, year, accept });
  expect((await ask([1])).data).toEqual({ status: "notShared" });
  await share(channel, ferryScope(2025));
  expect((await ask([1], 2025)).data).toMatchObject({
    status: "ok",
    snapshot: {
      schema: "travstats-leaderboard",
      version: 1,
      year: 2025,
      metrics: { ferryCrossings: 0 },
    },
  });
  expect((await ask([1], null)).data).toEqual({ status: "yearNotShared", year: 2025 });
  expect((await ask([2], 2025)).data).toEqual({ status: "unsupportedVersion", supported: [1] });
});

it("leaves every metric outside the consent's scope absent, not null", async () => {
  const channel = await claimed("hana");
  await share(channel, ferryScope(null));
  const reply = await send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  const metrics = Object.keys(reply.data.snapshot.metrics);
  const inScope = LEADERBOARD_METRICS.filter(
    (m) => m.group === "trips" && (m.domain === null || m.domain === "ferry")
  ).map((m) => m.key as string);
  expect(metrics.length).toBeGreaterThan(0);
  expect(metrics.filter((k) => !inScope.includes(k))).toEqual([]);
  expect(reply.data.snapshot.metrics).not.toHaveProperty("ferryKm");
});

it("exposes nothing while the consent is not accepted, even with a scope already stored", async () => {
  const channel = await claimed("ivy");
  const ask = () => send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  await share(channel, ferryScope(null), "pending");
  expect((await ask()).data).toEqual({ status: "notShared" });
  await share(channel, ferryScope(null), "declined");
  expect((await ask()).data).toEqual({ status: "notShared" });
  await share(channel, ferryScope(null), "withdrawn");
  expect((await ask()).data).toEqual({ status: "withdrawn" });
});

it("answers notShared for an accepted consent whose stored scope does not parse", async () => {
  const channel = await claimed("jo");
  await share(channel, { groups: ["nonsense"], domains: [], year: "x" });
  const reply = await send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  expect(reply).toEqual({ status: 200, data: { status: "notShared" } });
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "comparison_scope_invalid" }),
    expect.any(String)
  );
});

it("answers notShared for a deactivated owner", async () => {
  const channel = await claimed("dora");
  await share(channel, ferryScope(null));
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
  const reply = await send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
  expect(reply.data).toEqual({ status: "notShared" });
});

it("refuses a channel from another origin and logs unknown-channel", async () => {
  const channel = await claimed("finn");
  const reply = await send("other", { action: "aggregate", channel, year: null, accept: [1] });
  expect(reply.status).toBe(403);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "unknown-channel" }),
    "Comparison peer packet refused"
  );
});

it("refuses a suspended peer before reading anything", async () => {
  const channel = await claimed("kai");
  await share(channel, ferryScope(null));
  await prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { enabled: false } });
  // aggregate reads through prisma.leaderboardRemote; lb-state reads only inside its
  // transaction, where the client is `tx` — so the transaction itself must never open.
  const findRemote = jest.spyOn(prisma.leaderboardRemote, "findUnique");
  const transaction = jest.spyOn(prisma, "$transaction");
  const aggregate = await send("remote", { action: "aggregate", channel, year: null, accept: [1] });
  const state = await send("remote", { action: "lb-state", channel, status: "withdrawn" });
  const [reads, transactions] = [findRemote.mock.calls.length, transaction.mock.calls.length];
  findRemote.mockRestore();
  transaction.mockRestore();
  await prisma.comparisonPeer.update({ where: { origin: REMOTE }, data: { enabled: true } });
  expect([aggregate.status, state.status]).toEqual([403, 403]);
  expect([reads, transactions]).toEqual([0, 0]);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "unknown-peer" }),
    "Comparison peer packet refused"
  );
  expect(await prisma.leaderboardRemote.count({ where: { channel } })).toBe(1);
});

it("drops the friendship when the other server reports it ended", async () => {
  const channel = await claimed("gus");
  expect((await send("remote", { action: "lb-state", channel, status: "withdrawn" })).data).toEqual(
    { ok: true }
  );
  expect(await prisma.leaderboardRemote.findFirst({ where: { channel } })).toBeNull();
});

it("does not let another server end a friendship it does not hold", async () => {
  const channel = await claimed("lia");
  const reply = await send("other", { action: "lb-state", channel, status: "withdrawn" });
  expect(reply.status).toBe(403);
  expect(await prisma.leaderboardRemote.count({ where: { channel } })).toBe(1);
});

describe("the limit of 20 friends on other servers", () => {
  async function inviterWith(live: number) {
    const id = (
      await prisma.user.create({
        data: { username: `lb-cap-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
      })
    ).id;
    for (let i = 0; i < live; i += 1)
      await prisma.leaderboardRemote.create({
        data: {
          userId: id,
          origin: REMOTE,
          channel: randomUUID(),
          username: `f${i}`,
          displayName: `F${i}`,
          consents: { create: { ownerId: id } },
        },
      });
    return id;
  }
  const claim = (code: string, username: string) =>
    send("remote", { action: "lb-claim", code, username, displayName: username });

  it("refuses a claim on a full list like a bad code, and leaves the code unspent", async () => {
    const inviter = await inviterWith(20);
    try {
      const code = await invite(inviter);
      expect((await claim(code, "omar")).data).toEqual({ accepted: false });
      const row = await prisma.leaderboardInvite.findUniqueOrThrow({ where: { hash: hash(code) } });
      expect(row.usedAt).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: inviter } });
    }
  });

  it("accepts at most 20 when many claims arrive at once", async () => {
    // 17 live: not a multiple of the test pool's 5 connections (see remote.test.ts).
    const inviter = await inviterWith(17);
    try {
      const codes = await Promise.all(Array.from({ length: 10 }, () => invite(inviter)));
      const replies = await Promise.all(codes.map((code, i) => claim(code, `c${i}`)));
      expect(replies.filter((r) => r.data?.accepted === true)).toHaveLength(3);
      expect(replies.filter((r) => r.data?.accepted === false)).toHaveLength(7);
      expect(await prisma.leaderboardRemote.count({ where: { userId: inviter } })).toBe(20);
      expect(
        await prisma.leaderboardInvite.count({ where: { userId: inviter, usedAt: null } })
      ).toBe(7);
    } finally {
      await prisma.user.delete({ where: { id: inviter } });
    }
  });
});
