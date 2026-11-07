import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { exchange } from "../../federation/security";
import { loadIdentity } from "../../federation/identity";
import type { LeaderboardScope } from "../../../schemas/comparison";
import { pullRemote, claimInvite } from "../remote";
import { serveAggregate } from "../peerActions";

jest.mock("../../federation/security", () => ({
  ...jest.requireActual("../../federation/security"),
  exchange: jest.fn(),
}));
jest.mock("../../federation/identity", () => ({
  ...jest.requireActual("../../federation/identity"),
  loadIdentity: jest.fn(),
}));

const PEER = "https://peer.lb-mutual.test";
const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
let userId: string;
let warn: jest.SpyInstance;

async function remoteFor(consent: { status: string } | null, channel = randomUUID()) {
  return prisma.leaderboardRemote.create({
    data: {
      userId,
      origin: PEER,
      channel,
      username: `x-${channel.slice(0, 6)}`,
      displayName: "X",
      consents: consent
        ? {
            create: {
              ownerId: userId,
              status: consent.status,
              scope: SCOPE as never,
              decidedAt: new Date(),
            },
          }
        : undefined,
    },
  });
}
const v1 = (channel: string) => ({
  action: "aggregate" as const,
  channel,
  year: null,
  accept: [1],
});
const v2 = (channel: string, viewerShares: boolean) => ({
  action: "aggregate" as const,
  channel,
  year: null,
  accept: [1, 2],
  viewerShares,
});

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `lb-m-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  await prisma.comparisonPeer.upsert({
    where: { origin: PEER },
    create: { origin: PEER, publicKey: "unused", enabled: true, verifiedAt: new Date() },
    update: { enabled: true, verifiedAt: new Date() },
  });
});
beforeEach(() => {
  jest.mocked(exchange).mockReset();
  jest.mocked(loadIdentity).mockResolvedValue({ origin: "https://me.lb-mutual.test" } as never);
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".lb-mutual.test" } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("serving an aggregate under the mutual rule", () => {
  it("a v2 request whose viewer does not share gets notShared", async () => {
    const r = await remoteFor({ status: "accepted" });
    expect(await serveAggregate(PEER, v2(r.channel, false))).toEqual({ status: "notShared" });
  });

  it("a v2 request whose viewer shares gets the snapshot", async () => {
    const r = await remoteFor({ status: "accepted" });
    const reply = await serveAggregate(PEER, v2(r.channel, true));
    expect(reply.status).toBe("ok");
  });

  it("a v1 request is served as before", async () => {
    const r = await remoteFor({ status: "accepted" });
    expect((await serveAggregate(PEER, v1(r.channel))).status).toBe("ok");
  });

  it("B redeems, A has not answered: A's aggregate request for B gets notShared", async () => {
    const channel = randomUUID();
    jest.mocked(exchange).mockImplementation(async (_origin, body) => {
      if ((body as { action: string }).action === "ping")
        return { ready: true, leaderboard: [1, 2] };
      return { accepted: true, channel, username: "anna", displayName: "Anna" };
    });
    await prisma.comparisonPeer.update({
      where: { origin: PEER },
      data: { leaderboardVersions: [1, 2] },
    });
    // B's own consent is stored accepted by the claim ...
    await claimInvite(userId, `${PEER}#${"a".repeat(64)}`, SCOPE);
    const stored = await prisma.leaderboardRemote.findFirstOrThrow({
      where: { userId, channel },
      include: { consents: true },
    });
    expect(stored.consents[0].status).toBe("accepted");
    // ... but A's server (viewerShares false: A has not answered) gets nothing.
    expect(await serveAggregate(PEER, v2(channel, false))).toEqual({ status: "notShared" });
  });
});

describe("pullRemote protocol choice", () => {
  const sent = () => jest.mocked(exchange).mock.calls.at(-1)?.[1] as Record<string, unknown>;

  it("pullRemote sends a v1 body to a peer that only speaks v1", async () => {
    await prisma.comparisonPeer.update({
      where: { origin: PEER },
      data: { leaderboardVersions: [1] },
    });
    const r = await remoteFor({ status: "accepted" });
    jest.mocked(exchange).mockResolvedValueOnce({ status: "notShared" });
    await pullRemote(r, null);
    expect(JSON.stringify(sent())).not.toContain("viewerShares");
    expect(sent().accept).toEqual([1]);
  });

  it("pullRemote tells a v2 peer whether the local user shares with it", async () => {
    await prisma.comparisonPeer.update({
      where: { origin: PEER },
      data: { leaderboardVersions: [1, 2] },
    });
    const sharing = await remoteFor({ status: "accepted" });
    jest.mocked(exchange).mockResolvedValueOnce({ status: "notShared" });
    await pullRemote(sharing, null);
    expect(sent()).toMatchObject({ viewerShares: true, accept: [1, 2] });
    const asking = await remoteFor({ status: "pending" });
    jest.mocked(exchange).mockResolvedValueOnce({ status: "notShared" });
    await pullRemote(asking, null);
    expect(sent()).toMatchObject({ viewerShares: false });
  });
});
