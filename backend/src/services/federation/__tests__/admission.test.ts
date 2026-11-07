import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { approveAdmission, declineAdmission, listAdmissions } from "../admission";
import { fetchPeerIdentity } from "../admissionIdentity";
import { makeRequest, makeUser, peerKey } from "./admissionFixture";

jest.mock("../admissionIdentity", () => ({
  ...jest.requireActual("../admissionIdentity"),
  fetchPeerIdentity: jest.fn(),
}));

const ORIGIN = "https://far.admission.test";
let userId: string;
let adminId: string;
const origins: string[] = [];
const origin = (n: string) => {
  const o = `https://${n}.admission.test`;
  origins.push(o);
  return o;
};

beforeAll(async () => {
  userId = (await makeUser("adm-user")).id;
  adminId = (await makeUser("adm-admin", true)).id;
});
afterEach(async () => {
  await prisma.federationAdmissionRequest.deleteMany({ where: { localUserId: userId } });
  await prisma.comparisonPeer.deleteMany({ where: { origin: { in: [ORIGIN, ...origins] } } });
  jest.restoreAllMocks();
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  await prisma.$disconnect();
});

it("approve pins the peer and logs the admin", async () => {
  const key = peerKey();
  const row = await makeRequest(userId, ORIGIN, key);
  const info = jest.spyOn(logger, "info");
  const view = await approveAdmission(row.id, adminId);
  expect(view.status).toBe("approved");
  const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: ORIGIN } });
  expect(peer).toMatchObject({ publicKey: key.pem, enabled: true });
  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "federation_admission_approved",
      adminId,
      origin: ORIGIN,
      fingerprint: key.fingerprint,
    }),
    expect.any(String)
  );
  const stored = await prisma.federationAdmissionRequest.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(stored.decidedBy).toBe(adminId);
});

it("approve of an outgoing request marks it sent, not approved", async () => {
  const key = peerKey();
  (fetchPeerIdentity as jest.Mock).mockResolvedValue({
    origin: ORIGIN,
    publicKey: key.pem,
    fingerprint: key.fingerprint,
  });
  const row = await makeRequest(userId, ORIGIN, key, { direction: "outgoing" });
  expect((await approveAdmission(row.id, adminId)).status).toBe("sent");
});

it("approve refuses a key that differs from an existing pin", async () => {
  const pinned = peerKey();
  await prisma.comparisonPeer.create({ data: { origin: ORIGIN, publicKey: pinned.pem } });
  const row = await makeRequest(userId, ORIGIN, peerKey());
  await expect(approveAdmission(row.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_KEY_MISMATCH",
  });
  const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: ORIGIN } });
  expect(peer.publicKey).toBe(pinned.pem);
  expect(
    (await prisma.federationAdmissionRequest.findUniqueOrThrow({ where: { id: row.id } })).status
  ).toBe("pending");
});

it("approve refuses a suspended peer", async () => {
  const key = peerKey();
  await prisma.comparisonPeer.create({
    data: { origin: ORIGIN, publicKey: key.pem, enabled: false },
  });
  const row = await makeRequest(userId, ORIGIN, key);
  await expect(approveAdmission(row.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_SUSPENDED",
  });
  expect(
    (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: ORIGIN } })).enabled
  ).toBe(false);
});

it("approve on a peer already pinned with the same key keeps its verification", async () => {
  const key = peerKey();
  const verifiedAt = new Date();
  await prisma.comparisonPeer.create({ data: { origin: ORIGIN, publicKey: key.pem, verifiedAt } });
  const row = await makeRequest(userId, ORIGIN, key);
  await approveAdmission(row.id, adminId);
  expect(
    (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: ORIGIN } })).verifiedAt
  ).not.toBeNull();
});

it("a request is decided once: the second approve and a later decline are refused", async () => {
  const row = await makeRequest(userId, ORIGIN, peerKey());
  await approveAdmission(row.id, adminId);
  await expect(approveAdmission(row.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_NOT_PENDING",
  });
  await expect(declineAdmission(row.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_NOT_PENDING",
  });
});

it("decline stores nothing in the peer table and an expired request cannot be approved", async () => {
  const declined = await makeRequest(userId, ORIGIN, peerKey());
  expect((await declineAdmission(declined.id, adminId)).status).toBe("declined");
  expect(await prisma.comparisonPeer.findUnique({ where: { origin: ORIGIN } })).toBeNull();
  const old = await makeRequest(userId, origin("old"), peerKey());
  await prisma.federationAdmissionRequest.update({
    where: { id: old.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expect(approveAdmission(old.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_NOT_PENDING",
  });
  const views = await listAdmissions();
  expect(views.find((v) => v.id === old.id)?.status).toBe("expired");
});

it("approving an outgoing request starts its 14 days and makes it due for delivery", async () => {
  const key = peerKey();
  (fetchPeerIdentity as jest.Mock).mockResolvedValue({
    origin: ORIGIN,
    publicKey: key.pem,
    fingerprint: key.fingerprint,
  });
  const row = await makeRequest(userId, ORIGIN, key, { direction: "outgoing" });
  await prisma.federationAdmissionRequest.update({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await approveAdmission(row.id, adminId);
  const stored = await prisma.federationAdmissionRequest.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3_600_000);
  expect(stored.nextAttemptAt).toBeNull();
});

it("declining an incoming request burns its invitation token", async () => {
  const hashValue = "c".repeat(64);
  await prisma.leaderboardInvite.create({
    data: { hash: hashValue, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const row = await makeRequest(userId, ORIGIN, peerKey(), { inviteHash: hashValue });
  await declineAdmission(row.id, adminId);
  const invite = await prisma.leaderboardInvite.findUniqueOrThrow({ where: { hash: hashValue } });
  expect(invite.usedAt).not.toBeNull();
  await prisma.leaderboardInvite.delete({ where: { hash: hashValue } });
});

it("approve never overwrites a pin that appeared while the identity was being read", async () => {
  const key = peerKey();
  const rival = peerKey();
  (fetchPeerIdentity as jest.Mock).mockImplementation(async () => {
    await prisma.comparisonPeer.create({ data: { origin: ORIGIN, publicKey: rival.pem } });
    return { origin: ORIGIN, publicKey: key.pem, fingerprint: key.fingerprint };
  });
  const row = await makeRequest(userId, ORIGIN, key, { direction: "outgoing" });
  await expect(approveAdmission(row.id, adminId)).rejects.toMatchObject({
    code: "FEDERATION_ADMISSION_KEY_MISMATCH",
  });
  expect(
    (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: ORIGIN } })).publicKey
  ).toBe(rival.pem);
  expect(
    (await prisma.federationAdmissionRequest.findUniqueOrThrow({ where: { id: row.id } })).status
  ).toBe("pending");
});
