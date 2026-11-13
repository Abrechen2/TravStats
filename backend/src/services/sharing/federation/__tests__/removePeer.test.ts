import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import { removePeer } from "../removePeer";

/**
 * Removing a server ends everything that rode on its pin, not only the trip-sharing pairings
 * (Codex, rc.29 review): a leaderboard friendship, an end-to-end comparison grant, a queued
 * connection message or an admission request left behind would come back to life the moment the
 * same server was pinned again, without anyone reconnecting.
 */
const PEER = `https://remove-${randomUUID().slice(0, 8)}.example`;
const OTHER = `https://keep-${randomUUID().slice(0, 8)}.example`;
let userId = "";

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { username: `rmp-${randomUUID().slice(0, 8)}`, passwordHash: "x" },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.comparisonPeer.deleteMany({ where: { origin: { in: [PEER, OTHER] } } });
  await prisma.$disconnect();
});

async function seed(origin: string) {
  await prisma.comparisonPeer.create({ data: { origin, publicKey: "pem" } });
  const remote = await prisma.leaderboardRemote.create({
    data: { userId, origin, channel: randomUUID(), username: "ben", displayName: "Ben" },
  });
  await prisma.leaderboardConsent.create({
    data: { ownerId: userId, remoteId: remote.id, status: "accepted" },
  });
  const link = await prisma.comparisonLink.create({
    data: { channel: randomUUID(), userId, origin, label: "Ben", confirmed: true },
  });
  await prisma.comparisonGrant.create({ data: { linkId: link.id, scope: {} } });
  const pairing = await prisma.remoteShareAccount.create({
    data: {
      userId,
      origin,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "ben",
      displayName: "Ben",
      state: "revoked",
    },
  });
  await prisma.connectionAnnouncement.create({
    data: { connectionId: pairing.id, peerOrigin: origin, kind: "connect-settings", payload: {} },
  });
  await prisma.federationAdmissionRequest.create({
    data: {
      direction: "outgoing",
      origin,
      publicKey: "pem",
      fingerprint: "fp",
      localUserId: userId,
      inviteRef: "enc",
      status: "sent",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return link.id;
}

it("ends the friendships, grants, queued messages and admissions of the removed server only", async () => {
  const linkId = await seed(PEER);
  const keptLinkId = await seed(OTHER);

  await removePeer(PEER);

  expect(await prisma.leaderboardRemote.count({ where: { origin: PEER } })).toBe(0);
  expect(await prisma.leaderboardConsent.count({ where: { ownerId: userId } })).toBe(1);
  expect(await prisma.comparisonLink.findUnique({ where: { id: linkId } })).toMatchObject({
    revoked: true,
  });
  expect(await prisma.comparisonGrant.count({ where: { linkId, active: true } })).toBe(0);
  expect(await prisma.connectionAnnouncement.count({ where: { peerOrigin: PEER } })).toBe(0);
  expect(
    await prisma.federationAdmissionRequest.findFirst({ where: { origin: PEER } })
  ).toMatchObject({ status: "failed", failureReason: "peer-removed" });
  expect(await prisma.comparisonPeer.count({ where: { origin: PEER } })).toBe(0);

  // The other server keeps everything.
  expect(await prisma.leaderboardRemote.count({ where: { origin: OTHER } })).toBe(1);
  expect(await prisma.comparisonGrant.count({ where: { linkId: keptLinkId, active: true } })).toBe(
    1
  );
  expect(await prisma.connectionAnnouncement.count({ where: { peerOrigin: OTHER } })).toBe(1);
  expect(
    await prisma.federationAdmissionRequest.findFirst({ where: { origin: OTHER } })
  ).toMatchObject({ status: "sent" });
});
