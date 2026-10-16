import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { exchange } from "../../federation/security";
import { loadIdentity } from "../../federation/identity";
import { refused } from "../../federation/refusal";
import type { LeaderboardScope } from "../../../schemas/comparison";
import {
  claimInvite,
  createInvite,
  endRemote,
  parseInviteCode,
  peerReadiness,
  pullRemote,
} from "../remote";
import { declineConsent, listPeople } from "../consents";
import { readLeaderboard } from "../leaderboard";

jest.mock("../../federation/security", () => ({
  ...jest.requireActual("../../federation/security"),
  exchange: jest.fn(),
}));
jest.mock("../../federation/identity", () => ({
  ...jest.requireActual("../../federation/identity"),
  loadIdentity: jest.fn(),
}));

const PEER = "https://peer.lb-remote.test";
const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
const snapshot = (year: number | null) => ({
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T00:00:00.000Z",
  year,
  domains: ["flight"],
  metrics: { flights: 3 },
  partial: [],
});
const ping = { ready: true, leaderboard: [1] };
let userId: string;
let otherId: string;
let warn: jest.SpyInstance;
let info: jest.SpyInstance;

const newUser = async (prefix: string) =>
  (
    await prisma.user.create({
      data: { username: `${prefix}-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
const claimed = (channel = randomUUID(), username = "anna") => ({
  accepted: true,
  channel,
  username,
  displayName: `${username} A`,
});
async function remoteFor(owner: string, channel = randomUUID()) {
  return prisma.leaderboardRemote.create({
    data: {
      userId: owner,
      origin: PEER,
      channel,
      username: "x",
      displayName: "X",
      consents: {
        create: {
          ownerId: owner,
          status: "accepted",
          scope: SCOPE as never,
          decidedAt: new Date(),
        },
      },
    },
  });
}

/** Counts interactive and batch transactions that are open at a given moment. */
function watchTransactions() {
  const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
  let open = 0;
  const spy = jest.spyOn(prisma, "$transaction").mockImplementation((async (...args: unknown[]) => {
    open += 1;
    try {
      return await original(...args);
    } finally {
      open -= 1;
    }
  }) as never);
  return { open: () => open, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  userId = await newUser("lb-r");
  otherId = await newUser("lb-r2");
  await prisma.comparisonPeer.upsert({
    where: { origin: PEER },
    create: {
      origin: PEER,
      publicKey: "unused-in-this-test",
      enabled: true,
      verifiedAt: new Date(),
    },
    update: { enabled: true, verifiedAt: new Date() },
  });
});
beforeEach(async () => {
  jest.mocked(exchange).mockReset();
  jest.mocked(loadIdentity).mockResolvedValue({ origin: "https://me.lb-remote.test" } as never);
  // Refusals are logged by design (comparison_refused, *_failed); the assertions read them.
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
  await prisma.comparisonPeer.update({
    where: { origin: PEER },
    data: { leaderboardVersions: [], enabled: true },
  });
});
afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
});
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".lb-remote.test" } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});

it("reads an invitation code as origin and secret", () => {
  const secret = "a".repeat(64);
  expect(parseInviteCode(` ${PEER}#${secret} `)).toEqual({ origin: PEER, secret });
  for (const bad of [
    `http://x.example#${secret}`,
    `https://x.example:8443#${secret}`,
    `${PEER}#short`,
    `local#${secret}`,
    secret,
  ])
    expect(parseInviteCode(bad)).toBeNull();
});

describe("peer readiness", () => {
  it("trusts a stored version list without asking again", async () => {
    await prisma.comparisonPeer.update({
      where: { origin: PEER },
      data: { leaderboardVersions: [1] },
    });
    expect(await peerReadiness(PEER)).toBe("ready");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("stores nothing from a ping reply that does not parse", async () => {
    jest.mocked(exchange).mockResolvedValueOnce({ ready: true, leaderboard: ["1"] });
    expect(await peerReadiness(PEER)).toBe("unreachable");
    const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
    expect(peer.leaderboardVersions).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "comparison_peer_ping_failed", kind: "malformed" }),
      expect.any(String)
    );
  });

  it("does not write a ping answer over a peer the admin suspended meanwhile", async () => {
    jest.mocked(exchange).mockImplementationOnce(async () => {
      await prisma.comparisonPeer.update({ where: { origin: PEER }, data: { enabled: false } });
      return ping;
    });
    expect(await peerReadiness(PEER)).toBe("unknown");
    const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
    expect(peer.leaderboardVersions).toEqual([]);
  });
});

describe("claiming an invitation", () => {
  it("says the other server needs an update when its ping knows no leaderboard", async () => {
    jest.mocked(exchange).mockResolvedValueOnce({ ready: true });
    await expect(claimInvite(userId, `${PEER}#${"b".repeat(64)}`, SCOPE)).rejects.toMatchObject({
      code: "COMPARISON_PEER_OUTDATED",
    });
    expect(jest.mocked(exchange)).toHaveBeenCalledTimes(1);
  });

  it("does not ask a server the admin has not connected", async () => {
    await expect(
      claimInvite(userId, `https://stranger.lb-remote.test#${"b".repeat(64)}`, SCOPE)
    ).rejects.toMatchObject({ code: "COMPARISON_PEER_UNKNOWN" });
    expect(exchange).not.toHaveBeenCalled();
  });

  it("records the remote friend together with the claimant's own consent", async () => {
    jest.mocked(exchange).mockResolvedValueOnce(ping).mockResolvedValueOnce(claimed());
    const view = await claimInvite(userId, `${PEER}#${"c".repeat(64)}`, SCOPE);
    expect(view).toMatchObject({
      person: { kind: "remote", username: "anna", origin: PEER },
      mine: { status: "accepted", scope: SCOPE },
      theirs: null,
    });
    expect(
      (await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } }))
        .leaderboardVersions
    ).toEqual([1]);
  });

  it("calls the other server with no transaction open", async () => {
    const tx = watchTransactions();
    const openAtCall: number[] = [];
    jest.mocked(exchange).mockImplementation(async (_origin, body) => {
      openAtCall.push(tx.open());
      return body.action === "ping" ? ping : claimed(randomUUID(), "nora");
    });
    try {
      await claimInvite(userId, `${PEER}#${"d".repeat(64)}`, SCOPE);
    } finally {
      tx.restore();
    }
    expect(openAtCall).toEqual([0, 0]);
  });

  it("stores nothing when the other server refuses the code", async () => {
    jest.mocked(exchange).mockResolvedValueOnce(ping).mockResolvedValueOnce({ accepted: false });
    const before = await prisma.leaderboardRemote.count({ where: { userId } });
    await expect(claimInvite(userId, `${PEER}#${"e".repeat(64)}`, SCOPE)).rejects.toMatchObject({
      code: "COMPARISON_INVITE_INVALID",
    });
    expect(await prisma.leaderboardRemote.count({ where: { userId } })).toBe(before);
  });

  it("refuses a malformed claim reply and stores nothing", async () => {
    const before = await prisma.leaderboardRemote.count({ where: { userId } });
    for (const bad of [
      { accepted: true, channel: "not-a-uuid", username: "x", displayName: "X" },
      { ...claimed(), extra: "field" },
      { ...claimed(), username: "  " },
      "accepted",
    ]) {
      jest.mocked(exchange).mockResolvedValueOnce(ping).mockResolvedValueOnce(bad);
      await expect(claimInvite(userId, `${PEER}#${"f".repeat(64)}`, SCOPE)).rejects.toMatchObject({
        code: "COMPARISON_PEER_UNREACHABLE",
      });
    }
    expect(await prisma.leaderboardRemote.count({ where: { userId } })).toBe(before);
  });

  it("refuses a channel that already belongs to another friendship", async () => {
    const existing = await remoteFor(otherId);
    jest
      .mocked(exchange)
      .mockResolvedValueOnce(ping)
      .mockResolvedValueOnce(claimed(existing.channel, "mallory"));
    await expect(claimInvite(userId, `${PEER}#${"9".repeat(64)}`, SCOPE)).rejects.toMatchObject({
      code: "COMPARISON_PEER_UNREACHABLE",
    });
    const rows = await prisma.leaderboardRemote.findMany({
      where: { origin: PEER, channel: existing.channel },
      include: { consents: true },
    });
    expect(rows.map((r) => [r.userId, r.username, r.consents.length])).toEqual([[otherId, "x", 1]]);
  });
});

describe("the limit of 20 friends on other servers", () => {
  async function withLiveRemotes(count: number) {
    const owner = await newUser("lb-cap");
    for (let i = 0; i < count; i += 1) await remoteFor(owner);
    return owner;
  }

  it("refuses a 21st friend before the other server's invitation is spent", async () => {
    const owner = await withLiveRemotes(20);
    try {
      await expect(claimInvite(owner, `${PEER}#${"1".repeat(64)}`, SCOPE)).rejects.toMatchObject({
        code: "COMPARISON_REMOTE_LIMIT",
      });
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });

  it("keeps at most 20 when many claims run at once, and withdraws the extra ones there", async () => {
    const owner = await withLiveRemotes(17);
    const handedOut: string[] = [];
    const withdrawn: string[] = [];
    jest.mocked(exchange).mockImplementation(async (_origin, body) => {
      if (body.action === "ping") return ping;
      if (body.action === "lb-state") {
        withdrawn.push(body.channel);
        return { ok: true };
      }
      const channel = randomUUID();
      handedOut.push(channel);
      return claimed(channel, `p${handedOut.length}`);
    });
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => claimInvite(owner, `${PEER}#${"2".repeat(64)}`, SCOPE))
      );
      const codes = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason as { code?: string }).code);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(codes).toEqual(Array(7).fill("COMPARISON_REMOTE_LIMIT"));
      const stored = (
        await prisma.leaderboardRemote.findMany({
          where: { userId: owner },
          select: { channel: true },
        })
      ).map((r) => r.channel);
      expect(stored).toHaveLength(20);
      expect([...withdrawn].sort()).toEqual(handedOut.filter((c) => !stored.includes(c)).sort());
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });

  it("refuses the same person on the same server twice and withdraws the new question", async () => {
    const owner = await withLiveRemotes(0);
    try {
      jest
        .mocked(exchange)
        .mockResolvedValueOnce(ping)
        .mockResolvedValueOnce(claimed(randomUUID(), "anna"));
      await claimInvite(owner, `${PEER}#${"3".repeat(64)}`, SCOPE);
      const second = randomUUID();
      jest
        .mocked(exchange)
        .mockResolvedValueOnce(claimed(second, "anna"))
        .mockResolvedValueOnce({ ok: true });
      await expect(claimInvite(owner, `${PEER}#${"4".repeat(64)}`, SCOPE)).rejects.toMatchObject({
        code: "COMPARISON_DUPLICATE",
      });
      expect(exchange).toHaveBeenLastCalledWith(PEER, {
        action: "lb-state",
        channel: second,
        status: "withdrawn",
      });
      expect(await prisma.leaderboardRemote.count({ where: { userId: owner } })).toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });
});

describe("pulling a remote friend's totals", () => {
  const remote = () => ({
    id: randomUUID(),
    userId,
    origin: PEER,
    channel: randomUUID(),
    username: "x",
    displayName: "X",
    createdAt: new Date(),
  });
  beforeEach(() =>
    prisma.comparisonPeer.update({ where: { origin: PEER }, data: { leaderboardVersions: [1] } })
  );

  it("maps the other server's answers onto row statuses", async () => {
    const friend = remote();
    jest.mocked(exchange).mockResolvedValueOnce({ status: "yearNotShared", year: 2024 });
    expect(await pullRemote(friend, 2025)).toEqual({ status: "yearNotShared", sharedYear: 2024 });
    jest.mocked(exchange).mockResolvedValueOnce({ status: "withdrawn" });
    expect(await pullRemote(friend, null)).toEqual({ status: "withdrawn" });
    jest.mocked(exchange).mockRejectedValueOnce(new Error("socket hang up"));
    expect(await pullRemote(friend, null)).toEqual({ status: "unreachable" });
    jest.mocked(exchange).mockResolvedValueOnce({
      status: "ok",
      snapshot: { ...snapshot(null), metrics: JSON.parse('{"__proto__": 1}') },
    });
    expect(await pullRemote(friend, null)).toEqual({ status: "unreachable" });
    jest.mocked(exchange).mockResolvedValueOnce({ status: "ok", snapshot: snapshot(2025) });
    expect(await pullRemote(friend, 2025)).toEqual({ status: "ok", snapshot: snapshot(2025) });
  });

  it("reports a version mismatch as outdated and stops trusting the stored version list", async () => {
    jest.mocked(exchange).mockResolvedValueOnce({ status: "unsupportedVersion", supported: [2] });
    expect(await pullRemote(remote(), null)).toEqual({ status: "outdated" });
    const peer = await prisma.comparisonPeer.findUniqueOrThrow({ where: { origin: PEER } });
    expect(peer.leaderboardVersions).toEqual([]);
    // The next check asks the peer again instead of reading "ready" from the stale list.
    jest.mocked(exchange).mockResolvedValueOnce({ ready: true, leaderboard: [2] });
    expect(await pullRemote(remote(), null)).toEqual({ status: "outdated" });
    expect(exchange).toHaveBeenLastCalledWith(PEER, { action: "ping" });
  });

  it("asks for the friend's channel, the year and the versions it reads", async () => {
    const friend = remote();
    jest.mocked(exchange).mockResolvedValueOnce({ status: "notShared" });
    expect(await pullRemote(friend, 2025)).toEqual({ status: "notShared" });
    expect(exchange).toHaveBeenCalledWith(PEER, {
      action: "aggregate",
      channel: friend.channel,
      year: 2025,
      accept: [1],
    });
  });

  it("never shows totals for a year that was not asked for, or a reply it does not know", async () => {
    for (const bad of [
      { status: "ok", snapshot: snapshot(2024) },
      { status: "ok", snapshot: { ...snapshot(2025), version: 2 } },
      { status: "notShared", snapshot: snapshot(2025) },
      { status: "shared" },
      null,
    ]) {
      jest.mocked(exchange).mockResolvedValueOnce(bad);
      expect(await pullRemote(remote(), 2025)).toEqual({ status: "unreachable" });
    }
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "comparison_pull_failed", kind: "wrong-year" }),
      expect.any(String)
    );
  });

  it("asks nobody while this server is not connected", async () => {
    jest.mocked(loadIdentity).mockRejectedValueOnce(refused("federation-off"));
    expect(await pullRemote(remote(), null)).toEqual({ status: "federationOff" });
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe("invitations", () => {
  it("refuses to mint an invitation while this server is not connected", async () => {
    jest.mocked(loadIdentity).mockRejectedValueOnce(refused("federation-off"));
    await expect(createInvite(userId)).rejects.toMatchObject({ code: "COMPARISON_FEDERATION_OFF" });
  });

  it("mints a code of this server's origin and a 64-hex secret, valid 72 hours", async () => {
    const before = Date.now();
    const invite = await createInvite(userId);
    expect(invite.code).toMatch(/^https:\/\/me\.lb-remote\.test#[a-f0-9]{64}$/);
    const ttl = Date.parse(invite.expiresAt) - before;
    expect(ttl).toBeGreaterThanOrEqual(72 * 3_600_000 - 1000);
    expect(ttl).toBeLessThanOrEqual(72 * 3_600_000 + 1000);
  });

  it("keeps at most 20 open invitations, even when asked for many at once", async () => {
    const owner = await newUser("lb-inv");
    try {
      await prisma.leaderboardInvite.createMany({
        data: [
          { hash: randomUUID(), userId: owner, expiresAt: new Date(Date.now() - 1000) },
          {
            hash: randomUUID(),
            userId: owner,
            expiresAt: new Date(Date.now() + 3_600_000),
            usedAt: new Date(),
          },
          // 17 open: not a multiple of the test pool's 5 connections, so transactions that
          // merely happen to run in batches of five cannot land on 20 by luck.
          ...Array.from({ length: 17 }, () => ({
            hash: randomUUID(),
            userId: owner,
            expiresAt: new Date(Date.now() + 3_600_000),
          })),
        ],
      });
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => createInvite(owner))
      );
      const refusedCodes = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason as { code?: string }).code);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(refusedCodes).toEqual(Array(7).fill("COMPARISON_INVITE_LIMIT"));
      expect(await prisma.leaderboardInvite.count({ where: { userId: owner, usedAt: null } })).toBe(
        21
      );
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });
});

describe("ending a remote friendship", () => {
  it("removes it here at once, then tells the other server outside any transaction", async () => {
    const friend = await remoteFor(userId);
    const tx = watchTransactions();
    const seen: Array<{ open: number; rows: number }> = [];
    jest.mocked(exchange).mockImplementationOnce(async () => {
      seen.push({
        open: tx.open(),
        rows: await prisma.leaderboardRemote.count({ where: { id: friend.id } }),
      });
      return { ok: true };
    });
    try {
      await endRemote(userId, friend.id);
    } finally {
      tx.restore();
    }
    expect(seen).toEqual([{ open: 0, rows: 0 }]);
    expect(exchange).toHaveBeenCalledWith(PEER, {
      action: "lb-state",
      channel: friend.channel,
      status: "withdrawn",
    });
    expect(await prisma.leaderboardConsent.count({ where: { remoteId: friend.id } })).toBe(0);
  });

  it("does not end another user's friendship", async () => {
    const friend = await remoteFor(otherId);
    await expect(endRemote(userId, friend.id)).rejects.toMatchObject({
      code: "COMPARISON_NOT_FOUND",
    });
    expect(exchange).not.toHaveBeenCalled();
    expect(await prisma.leaderboardRemote.count({ where: { id: friend.id } })).toBe(1);
  });

  it("still ends it here when the other server cannot be told", async () => {
    const friend = await remoteFor(userId);
    jest.mocked(exchange).mockRejectedValueOnce(refused("unknown-channel"));
    await expect(endRemote(userId, friend.id)).resolves.toBeUndefined();
    expect(await prisma.leaderboardRemote.count({ where: { id: friend.id } })).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "comparison_remote_end_unsent",
        kind: "unknown-channel",
      }),
      expect.any(String)
    );
  });
});

describe("declining a request from another server", () => {
  /** What the other server's lb-claim leaves here: a remote friend and the owner's question. */
  async function questionFrom(owner: string, username = "bea", channel = randomUUID()) {
    const remote = await prisma.leaderboardRemote.create({
      data: {
        userId: owner,
        origin: PEER,
        channel,
        username,
        displayName: `${username} B`,
        consents: { create: { ownerId: owner } },
      },
      include: { consents: true },
    });
    return { remote, consentId: remote.consents[0].id };
  }
  const neverPulled = async () => ({ status: "unreachable" as const });

  it("removes the friend from the list and the leaderboard and tells the other server", async () => {
    const owner = await newUser("lb-dec");
    try {
      const { remote, consentId } = await questionFrom(owner);
      const tx = watchTransactions();
      const open: number[] = [];
      jest.mocked(exchange).mockImplementation(async () => {
        open.push(tx.open());
        return { ok: true };
      });
      try {
        await expect(declineConsent(owner, consentId)).resolves.toEqual({ declined: true });
      } finally {
        tx.restore();
      }
      expect(await prisma.leaderboardRemote.count({ where: { id: remote.id } })).toBe(0);
      expect(await prisma.leaderboardConsent.count({ where: { remoteId: remote.id } })).toBe(0);
      expect(exchange).toHaveBeenCalledWith(PEER, {
        action: "lb-state",
        channel: remote.channel,
        status: "withdrawn",
      });
      expect(open).toEqual([0]);
      const listedNow = await listPeople(owner);
      expect(listedNow.requests).toEqual([]);
      expect(listedNow.people).toEqual([]);
      const board = await readLeaderboard(owner, { year: null }, neverPulled);
      expect(board.rows.map((r) => r.person.kind)).toEqual(["self"]);
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });

  it("leaves no second question from the same person behind (two codes, one claimant)", async () => {
    const owner = await newUser("lb-dec2");
    try {
      const first = await questionFrom(owner, "bea");
      const second = await questionFrom(owner, "bea");
      const friend = await remoteFor(owner); // someone else, already a friend
      jest.mocked(exchange).mockResolvedValue({ ok: true });
      await declineConsent(owner, first.consentId);
      const left = await prisma.leaderboardRemote.findMany({
        where: { userId: owner },
        select: { id: true },
      });
      expect(left).toEqual([{ id: friend.id }]);
      for (const channel of [first.remote.channel, second.remote.channel])
        expect(exchange).toHaveBeenCalledWith(PEER, {
          action: "lb-state",
          channel,
          status: "withdrawn",
        });
      const board = await readLeaderboard(owner, { year: null }, neverPulled);
      expect(board.rows.filter((r) => r.person.kind === "remote")).toHaveLength(1);
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });

  it("still removes it here when the other server cannot be told", async () => {
    const owner = await newUser("lb-dec3");
    try {
      const { remote, consentId } = await questionFrom(owner);
      jest.mocked(exchange).mockRejectedValue(refused("unknown-channel"));
      await expect(declineConsent(owner, consentId)).resolves.toEqual({ declined: true });
      expect(await prisma.leaderboardRemote.count({ where: { id: remote.id } })).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "comparison_remote_end_unsent" }),
        expect.any(String)
      );
    } finally {
      await prisma.user.delete({ where: { id: owner } });
    }
  });
});
