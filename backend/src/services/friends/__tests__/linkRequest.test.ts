import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { hash } from "../../federation/refusal";
import { serveClaim } from "../../comparison/peerActions";
import { declineConsent } from "../../comparison/consents";
import { serveConnectRequest } from "../../sharing/federation/connections/serve";
import { activateConnection } from "../../sharing/federation/connections/activate";
import { DEFAULT_ON } from "../localConnections";
import { listFriends } from "../view";

jest.setTimeout(30_000);
const PEER = "https://redeemer.test";
const LOCAL = "https://inviter.test";
const NONE = {
  plans: false,
  stats: "off" as const,
  achievements: false,
  leaderboard: false,
  tripOffers: false,
};
const created: string[] = [];
async function inviter() {
  const u = await prisma.user.create({
    data: {
      username: `fr-lk-${randomUUID().slice(0, 8)}`,
      passwordHash: "test-only",
      federationFindable: false,
    },
  });
  created.push(u.id);
  return u;
}
/** What createInvite stores, without needing a server identity. */
async function invite(userId: string, switches?: object): Promise<string> {
  const secret = randomUUID().replace(/-/g, "").padEnd(64, "a");
  await prisma.leaderboardInvite.create({
    data: {
      hash: hash(secret),
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      ...(switches ? { switches } : {}),
    },
  });
  return secret;
}
const requestBody = (toUsername: string, leaderboardChannel: string, channel = randomUUID()) => ({
  kind: "connect-request" as const,
  messageId: randomUUID(),
  sentAt: new Date().toISOString(),
  channel,
  leaderboardChannel,
  generation: 1,
  toUsername,
  fromUsername: "lena",
  fromDisplayName: "Lena",
  switches: { ...DEFAULT_ON, plans: false },
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

it("a redeemed link is a request the inviter confirms: carries the link's switches, binds to the claim's pairing, and a stranger's guess is dropped", async () => {
  const a = await inviter();
  const link = { ...DEFAULT_ON, stats: "overview" as const, achievements: false };
  const secret = await invite(a.id, link);

  const claim = await serveClaim(PEER, {
    code: secret,
    username: "lena",
    displayName: "Lena",
  } as never);
  expect(claim.accepted).toBe(true);
  const channel = (claim as { channel: string }).channel;
  const lb = await prisma.leaderboardRemote.findFirstOrThrow({ where: { userId: a.id, channel } });
  expect(lb.inviteSwitches).toEqual(link);

  // A stranger who guesses the inviter's name without the claim's channel gets nothing — the
  // inviter is not findable.
  await serveConnectRequest(PEER, requestBody(a.username, randomUUID()), LOCAL);
  expect(await prisma.remoteShareAccount.count({ where: { userId: a.id } })).toBe(0);

  // The redeemer holds the channel: the request lands, bound to the pairing, waiting.
  await serveConnectRequest(PEER, requestBody(a.username, channel), LOCAL);
  const row = await prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: a.id } });
  expect(row).toMatchObject({ state: "pending_in", leaderboardRemoteId: lb.id });

  const { requests, friends } = await listFriends(a.id);
  expect(friends).toEqual([]);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    key: `remote:${lb.id}`,
    state: "pending_in",
    viaLink: true,
    proposed: link,
    switches: { ...DEFAULT_ON, plans: false },
    mine: NONE,
  });

  // Confirming binds the claim's pairing instead of treating its channel as taken.
  const plain = await prisma.remoteShareAccount.update({
    where: { id: row.id },
    data: { leaderboardRemoteId: null },
  });
  const linked = await prisma.$transaction((tx) => activateConnection(tx, plain, channel));
  expect(linked).toBe(channel);
  expect(
    (await prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: row.id } }))
      .leaderboardRemoteId
  ).toBe(lb.id);

  // Declining burns the link: the pairing goes with the question and the secret is spent.
  const question = await prisma.leaderboardConsent.findFirstOrThrow({
    where: { ownerId: a.id, remoteId: lb.id },
  });
  await declineConsent(a.id, question.id);
  expect(await prisma.leaderboardRemote.count({ where: { id: lb.id } })).toBe(0);
  expect(
    await serveClaim(PEER, { code: secret, username: "other", displayName: "Other" } as never)
  ).toEqual({ accepted: false });
});

it("a code or link from before carries no switches: the claim stays leaderboard-only", async () => {
  const a = await inviter();
  const secret = await invite(a.id);
  const claim = await serveClaim(PEER, {
    code: secret,
    username: "old",
    displayName: "Old",
  } as never);
  const lb = await prisma.leaderboardRemote.findFirstOrThrow({
    where: { userId: a.id, channel: (claim as { channel: string }).channel },
  });
  expect(lb.inviteSwitches).toBeNull();
  const list = await listFriends(a.id);
  expect(list.requests[0]).toMatchObject({
    comparisonOnly: true,
    olderServer: true,
    proposed: null,
  });
});
