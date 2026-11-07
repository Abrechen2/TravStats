import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, randomBytes } from "crypto";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { decryptApiKey } from "../../../utils/encryption";
import { getInstanceSettings } from "../../instanceSettingsService";
import comparison from "../../../routes/comparison";
import { approveAdmission } from "../../federation/admission";
import { fetchPeerIdentity } from "../../federation/admissionIdentity";
import { rawPublicKey } from "../../federation/rawKey";
import { makeUser, peerKey } from "../../federation/__tests__/admissionFixture";
import { pauseFederation, setFederationIdentity } from "../../federation/__tests__/identityFixture";
import { claimInvite } from "../remote";
import { createInviteLink, decodeInviteLinkPayload, redeemInviteLink } from "../inviteLinks";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../federation/admissionIdentity", () => ({
  ...jest.requireActual("../../federation/admissionIdentity"),
  fetchPeerIdentity: jest.fn(),
}));
jest.mock("../remote", () => ({
  ...jest.requireActual("../remote"),
  claimInvite: jest.fn(),
}));
jest.mock("../../../middleware/auth", () => ({
  ...jest.requireActual("../../../middleware/auth"),
  authenticate: (
    req: express.Request & { userId?: string },
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = req.header("x-test-user");
    next();
  },
}));

const app = express();
app.use(express.json());
app.use("/api/v1/comparison", comparison);
app.use(errorHandler);

const SCOPE = { groups: ["trips"], domains: ["ferry"], year: null };
const LOCAL = "https://self.invite-links.test";
const FAR = "https://far.invite-links.test";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "invite-links-"));
let restoreIdentity: () => Promise<void> = async () => undefined;
let user: { id: string };
let admin: { id: string };
let other: { id: string };

const fetchMock = fetchPeerIdentity as jest.Mock;
const claimMock = claimInvite as jest.Mock;

function linkFor(
  origin: string,
  key: ReturnType<typeof peerKey>,
  token = randomBytes(32).toString("hex"),
  expiresAtMs = Date.now() + 3_600_000
) {
  const payload = {
    v: 1,
    kind: "travstats-friend-invite",
    origin,
    publicKey: rawPublicKey(key.pem) as string,
    fingerprint: key.fingerprint,
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  return { token, text: Buffer.from(JSON.stringify(payload)).toString("base64url") };
}
const identityOf = (origin: string, key: ReturnType<typeof peerKey>) => ({
  origin,
  publicKey: key.pem,
  fingerprint: key.fingerprint,
});
const rows = () => prisma.federationAdmissionRequest.findMany({ where: { localUserId: user.id } });

beforeAll(async () => {
  const own = generateKeyPairSync("ed25519").privateKey;
  fs.writeFileSync(path.join(dir, "k.pem"), own.export({ type: "pkcs8", format: "pem" }));
  restoreIdentity = await setFederationIdentity(LOCAL, path.join(dir, "k.pem"));
  user = await makeUser("invl-user");
  admin = await makeUser("invl-admin", true);
  other = await makeUser("invl-other");
});
beforeEach(() => {
  jest.resetAllMocks();
  (getInstanceSettings as jest.Mock).mockResolvedValue({ betaFeaturesEnabled: true });
  claimMock.mockResolvedValue({});
});
afterEach(async () => {
  delete process.env.FEDERATION_PRIVATE_PEERS;
  await prisma.federationAdmissionRequest.deleteMany({
    where: { localUserId: { in: [user.id, other.id] } },
  });
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".invite-links.test" } } });
  await prisma.comparisonPeer.deleteMany({
    where: { origin: { startsWith: "http://192.168.50." } },
  });
  await prisma.leaderboardInvite.deleteMany({ where: { userId: user.id } });
});
afterAll(async () => {
  await restoreIdentity();
  await prisma.user.deleteMany({ where: { id: { in: [user.id, admin.id, other.id] } } });
  await prisma.$disconnect();
});

it("creates a link that carries this server's identity and a hashed single-use token", async () => {
  const { url, expiresAt } = await createInviteLink(user.id);
  expect(url.startsWith(`${LOCAL}/freunde/einladung#`)).toBe(true);
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  const payload = decodeInviteLinkPayload(url.split("#")[1] as string);
  expect(payload.origin).toBe(LOCAL);
  const stored = await prisma.leaderboardInvite.findMany({ where: { userId: user.id } });
  expect(stored).toHaveLength(1);
  expect(stored[0]?.hash).not.toBe(payload.token);
});

it("redeem against a pinned peer claims at once", async () => {
  const key = peerKey();
  await prisma.comparisonPeer.create({ data: { origin: FAR, publicKey: key.pem } });
  const { token, text } = linkFor(FAR, key);
  expect(await redeemInviteLink(user.id, text, SCOPE)).toEqual({ status: "claimed" });
  expect(claimMock).toHaveBeenCalledWith(user.id, `${FAR}#${token}`, SCOPE);
  expect(await rows()).toHaveLength(0);
});

it("redeem against an unknown server creates an outgoing request", async () => {
  const key = peerKey();
  fetchMock.mockResolvedValue(identityOf(FAR, key));
  const { token, text } = linkFor(FAR, key);
  expect(await redeemInviteLink(user.id, text, SCOPE)).toEqual({ status: "awaitingAdmin" });
  const [row] = await rows();
  expect(row).toMatchObject({
    direction: "outgoing",
    origin: FAR,
    status: "pending",
    fingerprint: key.fingerprint,
  });
  expect(row?.inviteRef).not.toContain(token);
  expect(decryptApiKey(row?.inviteRef as string)).toBe(token);
  expect(row?.scope).toEqual(SCOPE);
  // The token dies with the link, so the request must not outlive it.
  expect(row?.expiresAt.getTime()).toBeLessThan(Date.now() + 2 * 3_600_000);
  expect(claimMock).not.toHaveBeenCalled();
  expect(await prisma.comparisonPeer.findUnique({ where: { origin: FAR } })).toBeNull();
  // The same link again answers the open request instead of making a second one.
  expect(await redeemInviteLink(user.id, text, SCOPE)).toEqual({ status: "awaitingAdmin" });
  expect(await rows()).toHaveLength(1);
});

it("a changed key is refused", async () => {
  const pinned = peerKey();
  const rotated = peerKey();
  // The server is pinned with its old key, the link carries the new one.
  await prisma.comparisonPeer.create({ data: { origin: FAR, publicKey: pinned.pem } });
  await expect(redeemInviteLink(user.id, linkFor(FAR, rotated).text, SCOPE)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_KEY_MISMATCH",
  });
  expect(
    (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: FAR } })).publicKey
  ).toBe(pinned.pem);
  // Unknown server whose identity endpoint now publishes another key than the link carries.
  const NEW = "https://new.invite-links.test";
  fetchMock.mockResolvedValue(identityOf(NEW, rotated));
  await expect(redeemInviteLink(user.id, linkFor(NEW, pinned).text, SCOPE)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_KEY_MISMATCH",
  });
  expect(await rows()).toHaveLength(0);
  expect(claimMock).not.toHaveBeenCalled();
});

it("a suspended peer is refused, never re-enabled", async () => {
  const key = peerKey();
  await prisma.comparisonPeer.create({ data: { origin: FAR, publicKey: key.pem, enabled: false } });
  await expect(redeemInviteLink(user.id, linkFor(FAR, key).text, SCOPE)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_SUSPENDED",
  });
  expect((await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: FAR } })).enabled).toBe(
    false
  );
});

it("federation off is refused", async () => {
  const resume = await pauseFederation();
  try {
    await expect(
      redeemInviteLink(user.id, linkFor(FAR, peerKey()).text, SCOPE)
    ).rejects.toMatchObject({
      code: "FEDERATION_ADMISSION_DISABLED",
    });
    expect(await rows()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    await resume();
  }
});

it("an oversized payload is a 400", async () => {
  const res = await request(app)
    .post("/api/v1/comparison/invite-links/redeem")
    .set("x-test-user", user.id)
    .send({ payload: "A".repeat(1025), scope: SCOPE });
  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  const damaged = await request(app)
    .post("/api/v1/comparison/invite-links/redeem")
    .set("x-test-user", user.id)
    .send({ payload: "not-a-link", scope: SCOPE });
  expect(damaged.status).toBe(400);
  expect(damaged.body.code).toBe("FEDERATION_ADMISSION_INVALID");
});

it("the routes create a link, redeem it and list the caller's own requests", async () => {
  const create = await request(app)
    .post("/api/v1/comparison/invite-links")
    .set("x-test-user", user.id)
    .send({});
  expect(create.status).toBe(201);
  expect(create.body.data.url).toContain("/freunde/einladung#");
  const key = peerKey();
  fetchMock.mockResolvedValue(identityOf(FAR, key));
  const redeem = await request(app)
    .post("/api/v1/comparison/invite-links/redeem")
    .set("x-test-user", user.id)
    .send({ payload: linkFor(FAR, key).text, scope: SCOPE });
  expect(redeem.status).toBe(200);
  expect(redeem.body.data).toEqual({ status: "awaitingAdmin" });
  const mine = await request(app).get("/api/v1/comparison/admissions").set("x-test-user", user.id);
  expect(mine.body.data.admissions).toHaveLength(1);
  const theirs = await request(app)
    .get("/api/v1/comparison/admissions")
    .set("x-test-user", other.id);
  expect(theirs.body.data.admissions).toHaveLength(0);
});

it("a sixth open request of one user is refused", async () => {
  for (let i = 0; i < 5; i++) {
    const key = peerKey();
    const origin = `https://s${i}.invite-links.test`;
    fetchMock.mockResolvedValue(identityOf(origin, key));
    await redeemInviteLink(user.id, linkFor(origin, key).text, SCOPE);
  }
  const key = peerKey();
  const origin = "https://s6.invite-links.test";
  fetchMock.mockResolvedValue(identityOf(origin, key));
  await expect(redeemInviteLink(user.id, linkFor(origin, key).text, SCOPE)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_FULL",
  });
  expect(await rows()).toHaveLength(5);
});

it("a private origin is not fetched on redeem, only on approve", async () => {
  process.env.FEDERATION_PRIVATE_PEERS = "192.168.50.0/24";
  const LAN = "http://192.168.50.7:3010";
  const key = peerKey();
  const { text } = linkFor(LAN, key);
  expect(await redeemInviteLink(user.id, text, SCOPE)).toEqual({ status: "awaitingAdmin" });
  expect(fetchMock).not.toHaveBeenCalled();
  const [row] = await rows();
  // The admin's approval reads the identity; a different key than the link carried is refused.
  fetchMock.mockResolvedValue(identityOf(LAN, peerKey()));
  await expect(approveAdmission(row?.id as string, admin.id)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_KEY_MISMATCH",
  });
  expect(fetchMock).toHaveBeenCalledWith(LAN);
  expect(await prisma.comparisonPeer.findUnique({ where: { origin: LAN } })).toBeNull();
  fetchMock.mockResolvedValue(identityOf(LAN, key));
  expect((await approveAdmission(row?.id as string, admin.id)).status).toBe("sent");
  expect(
    (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: LAN } })).publicKey
  ).toBe(key.pem);
});

describe("an invitation's lifetime is the issuer's, not the payload's (forgejo#416)", () => {
  it("a far-future expiresAt in a payload is refused, never stored", async () => {
    const key = peerKey();
    fetchMock.mockResolvedValue(identityOf(FAR, key));
    const { text } = linkFor(FAR, key, undefined, Date.now() + 365 * 24 * 3_600_000);
    await expect(redeemInviteLink(user.id, text, SCOPE)).rejects.toMatchObject({
      code: "FEDERATION_ADMISSION_INVALID",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("an expiresAt a little beyond 72 h is clamped to 72 h", async () => {
    const key = peerKey();
    fetchMock.mockResolvedValue(identityOf(FAR, key));
    const { text } = linkFor(FAR, key, undefined, Date.now() + 72 * 3_600_000 + 4 * 60_000);
    await redeemInviteLink(user.id, text, SCOPE);
    const [row] = await rows();
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 72 * 3_600_000);
  });
});
