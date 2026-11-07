import express from "express";
import request from "supertest";
import { ipKeyGenerator } from "express-rate-limit";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes } from "crypto";
import { prisma } from "../../../db";
import { decryptApiKey } from "../../../utils/encryption";
import { getInstanceSettings } from "../../instanceSettingsService";
import { claimInvite } from "../../comparison/remote";
import admissionRoutes, { admissionLimiter } from "../../../routes/federationAdmission";
import { ADMISSION_ACCEPTS, envelope, verifyEnvelope } from "../envelope";
import { fetchPeerIdentity } from "../admissionIdentity";
import { ADMISSION_WINDOW_MS, declineAdmission } from "../admission";
import { backoffMs, deliverAdmission, runAdmissionDeliveries } from "../admissionDelivery";
import { verifyPeerByPing } from "../peerVerification";
import { hash, refused } from "../refusal";
import { exchange } from "../security";
import { makeRequest, makeUser, peerKey } from "./admissionFixture";
import { setFederationIdentity } from "./identityFixture";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../admissionIdentity", () => ({
  ...jest.requireActual("../admissionIdentity"),
  fetchPeerIdentity: jest.fn(),
}));
jest.mock("../peerVerification", () => ({ verifyPeerByPing: jest.fn() }));
jest.mock("../security", () => ({ ...jest.requireActual("../security"), exchange: jest.fn() }));
jest.mock("../../comparison/remote", () => ({
  ...jest.requireActual("../../comparison/remote"),
  claimInvite: jest.fn(),
}));

const LOCAL = "https://self.admission-boot.test";
const SENDER = "https://sender.admission-boot.test";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admission-boot-"));
const localPair = generateKeyPairSync("ed25519");
const sender = peerKey();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1/federation-admission", admissionRoutes);

let restoreIdentity: () => Promise<void> = async () => undefined;
let inviter: { id: string };
let requester: { id: string };
const fetchMock = fetchPeerIdentity as jest.Mock;
const exchangeMock = exchange as jest.Mock;
const claimMock = claimInvite as jest.Mock;
const pingMock = verifyPeerByPing as jest.Mock;

async function invite(opts: { used?: boolean; expired?: boolean } = {}) {
  const token = randomBytes(32).toString("hex");
  await prisma.leaderboardInvite.create({
    data: {
      hash: hash(token),
      userId: inviter.id,
      expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 72 * 3_600_000)),
      usedAt: opts.used ? new Date() : null,
    },
  });
  return token;
}
const packet = (
  token: string,
  opts: { origin?: string; key?: typeof sender; purpose?: "admission/1" | "comparison/1" } = {}
) =>
  envelope(
    { action: "admit", origin: opts.origin ?? SENDER, token },
    LOCAL,
    { origin: opts.origin ?? SENDER, key: (opts.key ?? sender).privateKey },
    undefined,
    opts.purpose ?? "admission/1"
  );
const post = (body: unknown) =>
  request(app)
    .post("/api/v1/federation-admission")
    .send(body as object);
const incoming = () =>
  prisma.federationAdmissionRequest.findMany({ where: { localUserId: inviter.id } });
const reads = (res: request.Response) =>
  JSON.parse(
    verifyEnvelope(
      res.body,
      localPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      SENDER,
      Date.now(),
      ADMISSION_ACCEPTS
    ).body
  );

beforeAll(async () => {
  fs.writeFileSync(
    path.join(dir, "k.pem"),
    localPair.privateKey.export({ type: "pkcs8", format: "pem" })
  );
  restoreIdentity = await setFederationIdentity(LOCAL, path.join(dir, "k.pem"));
  inviter = await makeUser("boot-inviter");
  requester = await makeUser("boot-requester");
});
beforeEach(async () => {
  await admissionLimiter.resetKey(ipKeyGenerator("::ffff:127.0.0.1"));
  await admissionLimiter.resetKey(ipKeyGenerator("127.0.0.1"));
  jest.resetAllMocks();
  (getInstanceSettings as jest.Mock).mockResolvedValue({ betaFeaturesEnabled: true });
  fetchMock.mockImplementation(async (origin: string) => ({
    origin,
    publicKey: sender.pem,
    fingerprint: sender.fingerprint,
  }));
  pingMock.mockResolvedValue(true);
});
afterEach(async () => {
  await prisma.federationAdmissionRequest.deleteMany({
    where: { localUserId: { in: [inviter.id, requester.id] } },
  });
  await prisma.leaderboardInvite.deleteMany({ where: { userId: inviter.id } });
  await prisma.comparisonPeer.deleteMany({
    where: { origin: { endsWith: ".admission-boot.test" } },
  });
});
afterAll(async () => {
  await restoreIdentity();
  await prisma.user.deleteMany({ where: { id: { in: [inviter.id, requester.id] } } });
  await prisma.$disconnect();
});

describe("the bootstrap route", () => {
  it("an unsigned or wrongly signed admit is 403 and stores nothing", async () => {
    const token = await invite();
    expect((await post({})).status).toBe(403);
    expect((await post({ ...packet(token), signature: "AAAA" })).status).toBe(403);
    // Signed by a key the identity endpoint does not vouch for.
    expect((await post(packet(token, { key: peerKey() }))).status).toBe(403);
    // Body changed after signing.
    const forged = packet(token);
    expect((await post({ ...forged, body: forged.body.replace(SENDER, LOCAL) })).status).toBe(403);
    // Signed for the other protocol.
    expect((await post(packet(token, { purpose: "comparison/1" }))).status).toBe(403);
    expect(await incoming()).toHaveLength(0);
  });

  it("an admit without a valid token is 403 and stores nothing", async () => {
    for (const token of [
      randomBytes(32).toString("hex"),
      await invite({ used: true }),
      await invite({ expired: true }),
    ]) {
      expect((await post(packet(token))).status).toBe(403);
    }
    // The sender's identity is never fetched for a caller without a valid token.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await incoming()).toHaveLength(0);
  });

  it("a valid admit creates one incoming request", async () => {
    const token = await invite();
    const res = await post(packet(token));
    expect(res.status).toBe(200);
    expect(reads(res)).toEqual({ status: "pending" });
    const rows = await incoming();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "incoming",
      origin: SENDER,
      status: "pending",
      fingerprint: sender.fingerprint,
      publicKey: sender.pem,
    });
    expect(decryptApiKey(rows[0]?.inviteRef as string)).toBe(token);
    // The token outlives its 72 hours while the request is open, and is not spent yet.
    const stored = await prisma.leaderboardInvite.findUniqueOrThrow({
      where: { hash: hash(token) },
    });
    expect(stored.usedAt).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + ADMISSION_WINDOW_MS - 60_000);
    // The same ask again (the sender retries) answers the same request.
    expect(reads(await post(packet(token)))).toEqual({ status: "pending" });
    expect(await incoming()).toHaveLength(1);
  });

  it("the same token admitted twice concurrently yields one request", async () => {
    const token = await invite();
    const results = await Promise.all(Array.from({ length: 6 }, () => post(packet(token))));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await incoming()).toHaveLength(1);
  });

  it("a token belongs to the first server that presented it", async () => {
    const token = await invite();
    expect((await post(packet(token))).status).toBe(200);
    const other = peerKey();
    const OTHER = "https://other.admission-boot.test";
    fetchMock.mockResolvedValue({
      origin: OTHER,
      publicKey: other.pem,
      fingerprint: other.fingerprint,
    });
    expect((await post(packet(token, { origin: OTHER, key: other }))).status).toBe(403);
    expect(await incoming()).toHaveLength(1);
  });

  it("a server pinned with the same key goes straight to the claim, a changed or suspended one is refused", async () => {
    const token = await invite();
    await prisma.comparisonPeer.create({ data: { origin: SENDER, publicKey: sender.pem } });
    const res = await post(packet(token));
    expect(reads(res)).toEqual({ status: "approved" });
    expect(await incoming()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pingMock).toHaveBeenCalledWith(SENDER);
    // Signed by a different key than the pin: the pin is the authority, nothing is re-read.
    expect((await post(packet(await invite(), { key: peerKey() }))).status).toBe(403);
    await prisma.comparisonPeer.update({ where: { origin: SENDER }, data: { enabled: false } });
    expect((await post(packet(await invite()))).status).toBe(403);
  });

  it("a token bound to one server is refused to another, pinned or not", async () => {
    const token = await invite();
    expect((await post(packet(token))).status).toBe(200);
    const other = peerKey();
    const OTHER = "https://pinned-other.admission-boot.test";
    await prisma.comparisonPeer.create({ data: { origin: OTHER, publicKey: other.pem } });
    expect((await post(packet(token, { origin: OTHER, key: other }))).status).toBe(403);
    expect(await incoming()).toHaveLength(1);
  });

  it("a token spent while the sender's identity is being read creates no request", async () => {
    const token = await invite();
    fetchMock.mockImplementation(async (origin: string) => {
      await prisma.leaderboardInvite.update({
        where: { hash: hash(token) },
        data: { usedAt: new Date() },
      });
      return { origin, publicKey: sender.pem, fingerprint: sender.fingerprint };
    });
    expect((await post(packet(token))).status).toBe(403);
    expect(await incoming()).toHaveLength(0);
  });

  it("a declined request keeps answering declined to its sender and to nobody else", async () => {
    const token = await invite();
    expect(reads(await post(packet(token)))).toEqual({ status: "pending" });
    const [row] = await incoming();
    await declineAdmission(row?.id as string, requester.id);
    expect(reads(await post(packet(token)))).toEqual({ status: "declined" });
    const other = peerKey();
    const OTHER = "https://other2.admission-boot.test";
    fetchMock.mockResolvedValue({
      origin: OTHER,
      publicKey: other.pem,
      fingerprint: other.fingerprint,
    });
    expect((await post(packet(token, { origin: OTHER, key: other }))).status).toBe(403);
  });

  it("a refused ask does not extend the token", async () => {
    for (let i = 0; i < 20; i++)
      await makeRequest(inviter.id, `https://q${i}.admission-boot.test`, peerKey());
    const token = await invite();
    const before = await prisma.leaderboardInvite.findUniqueOrThrow({
      where: { hash: hash(token) },
    });
    expect(reads(await post(packet(token)))).toEqual({ status: "refused", reason: "full" });
    const after = await prisma.leaderboardInvite.findUniqueOrThrow({
      where: { hash: hash(token) },
    });
    expect(after.expiresAt).toEqual(before.expiresAt);
  });

  it("a full queue answers a signed refusal, not a stored request", async () => {
    for (let i = 0; i < 20; i++)
      await makeRequest(inviter.id, `https://q${i}.admission-boot.test`, peerKey());
    const res = await post(packet(await invite()));
    expect(res.status).toBe(200);
    expect(reads(res)).toEqual({ status: "refused", reason: "full" });
    expect(await incoming()).toHaveLength(20);
  });

  it("limits one address to ten asks a minute", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post({})).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(403));
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("answers 403 while the beta switch is off", async () => {
    (getInstanceSettings as jest.Mock).mockResolvedValue({ betaFeaturesEnabled: false });
    expect((await post(packet(await invite()))).status).toBe(403);
    expect(await incoming()).toHaveLength(0);
  });
});

describe("the delivery job", () => {
  const TARGET = "https://target.admission-boot.test";
  const scope = { groups: ["trips"], domains: ["ferry"], year: null };
  async function outgoing() {
    const key = peerKey();
    await prisma.comparisonPeer.create({ data: { origin: TARGET, publicKey: key.pem } });
    const row = await makeRequest(requester.id, TARGET, key, {
      direction: "outgoing",
      status: "sent",
      scope,
      token: "b".repeat(64),
    });
    return row;
  }
  const state = (id: string) =>
    prisma.federationAdmissionRequest.findUniqueOrThrow({ where: { id } });

  it("an unreachable peer is retried and expires after 14 days", async () => {
    const row = await outgoing();
    exchangeMock.mockRejectedValue(refused("unreachable"));
    const t0 = new Date();
    expect(await deliverAdmission(row.id, t0)).toBe("retry");
    expect((await state(row.id)).nextAttemptAt?.getTime()).toBe(t0.getTime() + backoffMs(0));
    // Not due yet: nothing is sent.
    exchangeMock.mockClear();
    expect(await deliverAdmission(row.id, new Date(t0.getTime() + 30_000))).toBe("skipped");
    expect(exchangeMock).not.toHaveBeenCalled();
    // The backoff doubles up to six hours and then stays there.
    expect(backoffMs(1)).toBe(2 * backoffMs(0));
    expect(backoffMs(30)).toBe(6 * 3_600_000);
    let now = t0.getTime();
    let outcome = "retry";
    for (let i = 0; i < 200 && outcome === "retry"; i++) {
      now += 6 * 3_600_000;
      outcome = await deliverAdmission(row.id, new Date(now));
    }
    expect(outcome).toBe("expired");
    expect(now - t0.getTime()).toBeGreaterThanOrEqual(ADMISSION_WINDOW_MS - 1000);
    expect((await state(row.id)).status).toBe("expired");
    // An expired request is never sent again.
    exchangeMock.mockClear();
    expect(await runAdmissionDeliveries(new Date(now + 1000))).toBe(0);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("waits while the other admin has not decided, then runs the claim once admitted", async () => {
    const row = await outgoing();
    const t0 = new Date();
    exchangeMock.mockResolvedValue({ status: "pending" });
    expect(await deliverAdmission(row.id, t0)).toBe("retry");
    expect(claimMock).not.toHaveBeenCalled();
    exchangeMock.mockResolvedValue({ status: "approved" });
    claimMock.mockResolvedValue({});
    const later = new Date(t0.getTime() + 2 * 3_600_000);
    expect(await deliverAdmission(row.id, later)).toBe("approved");
    expect(pingMock).toHaveBeenCalledWith(TARGET);
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(requester.id, `${TARGET}#${"b".repeat(64)}`, scope);
    expect((await state(row.id)).status).toBe("approved");
    // Settled: a second pass neither asks nor claims again.
    expect(await deliverAdmission(row.id, new Date(later.getTime() + 1000))).toBe("skipped");
    expect(claimMock).toHaveBeenCalledTimes(1);
  });

  it("a token the other server refuses, a decline and a refusal end the request with a reason", async () => {
    let row = await outgoing();
    exchangeMock.mockRejectedValue(refused("remote-refused"));
    expect(await deliverAdmission(row.id)).toBe("failed");
    expect(await state(row.id)).toMatchObject({ status: "failed", failureReason: "token-refused" });
    await prisma.federationAdmissionRequest.delete({ where: { id: row.id } });
    row = await makeRequest(requester.id, TARGET, peerKey(), {
      direction: "outgoing",
      status: "sent",
      scope,
    });
    exchangeMock.mockResolvedValue({ status: "declined" });
    expect(await deliverAdmission(row.id)).toBe("declined");
    await prisma.federationAdmissionRequest.update({
      where: { id: row.id },
      data: { status: "sent", nextAttemptAt: null },
    });
    exchangeMock.mockResolvedValue({ status: "refused", reason: "full" });
    expect(await deliverAdmission(row.id)).toBe("failed");
    expect(await state(row.id)).toMatchObject({ failureReason: "full" });
    expect(claimMock).not.toHaveBeenCalled();
  });
});
