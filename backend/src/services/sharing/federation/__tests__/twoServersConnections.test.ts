/**
 * User connections across two servers (spec 2026-11-02): one person asks another, the other
 * confirms with their own switches, and exactly what each side switched on — nothing else — works.
 * Driven through the real signed transport; each test names the defect it guards against.
 */
import { randomUUID } from "crypto";
import {
  A,
  B,
  OFF,
  connect,
  pin,
  servers,
  user,
  useTwoServers,
  type Server,
} from "./twoServerHarness";
import { addFlight } from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const nameOf = async (s: Server, id: string) =>
  (await s.prisma.user.findUniqueOrThrow({ where: { id } })).username;
const rowOf = (s: Server, userId: string, origin: string) =>
  s.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId, origin } });
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

async function people() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  await b.prisma.user.update({ where: { id: ben }, data: { federationFindable: true } });
  return { anna, ben, benName: await nameOf(b, ben) };
}

describe("asking and confirming", () => {
  it("a request is pending on both sides and shows the asker's choice before the person sets their own", async () => {
    const { anna, ben, benName } = await people();
    const asked = await a.connections.requestConnection(anna, {
      origin: B,
      username: benName,
      switches: { ...OFF, plans: true, stats: "overview" },
    });
    expect(asked.state).toBe("pending_out");
    const onB = await rowOf(b, ben, A);
    expect(onB.state).toBe("pending_in");
    const [view] = await b.connectionView.listConnections(ben);
    expect(view).toMatchObject({
      state: "pending_in",
      theirs: { plans: true, stats: "overview" },
      mine: OFF,
    });
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(1);
    // Nothing is shared before the confirmation: all of Ben's switches are off.
    expect(onB).toMatchObject({ sharePlans: false, statsLevel: "off", shareTripOffers: false });
  });

  it("confirming makes both sides active, each with its own directional switches", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, {
      asker: { stats: "full", achievements: true },
      target: { plans: true, tripOffers: true },
    });
    const fromA = await a.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onFrom } });
    const fromB = await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onTo } });
    expect([fromA.state, fromB.state]).toEqual(["active", "active"]);
    expect(fromA).toMatchObject({ statsLevel: "full", shareAchievements: true, sharePlans: false });
    expect(fromB).toMatchObject({ sharePlans: true, shareTripOffers: true, statsLevel: "off" });
    // Each side sees what the other announced.
    expect(await a.connectionView.readConnection(anna, onFrom)).toMatchObject({
      theirs: { plans: true, tripOffers: true, stats: "off" },
      mine: { stats: "full", achievements: true },
    });
    expect(fromA.channel).toBe(fromB.localChannel);
    expect(fromA.localChannel).toBe(fromB.channel);
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(0);
  });

  it("answers a request to anyone alike: unknown, not findable and deactivated people leave no trace", async () => {
    const anna = await user(a, "Anna");
    const quiet = await user(b, "Quiet"); // findable stays off
    const gone = await user(b, "Gone");
    await b.prisma.user.update({
      where: { id: gone },
      data: { federationFindable: true, isActive: false },
    });
    const { benName } = await people();
    const body = (username: string) => ({
      kind: "connect-request" as const,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      channel: randomUUID(),
      leaderboardChannel: randomUUID(),
      generation: 1,
      toUsername: username,
      fromUsername: "anna",
      fromDisplayName: "Anna",
      switches: OFF,
    });
    const names = ["nobody-by-that-name", await nameOf(b, quiet), await nameOf(b, gone), benName];
    const answers = [];
    for (const n of names) answers.push(await b.connectionServe.serveConnectRequest(A, body(n), B));
    for (const answer of answers) expect(answer).toEqual({ received: true });
    // Only the findable, active person got an inbox item.
    expect(
      await b.prisma.remoteShareAccount.count({
        where: { state: "pending_in", user: { username: benName } },
      })
    ).toBe(1);
    expect(
      await b.prisma.remoteShareAccount.count({ where: { userId: { in: [quiet, gone] } } })
    ).toBe(0);
    // Over the wire the asker is told "sent" for a stranger, too.
    const sent = await a.connections.requestConnection(anna, {
      origin: B,
      username: "nobody-by-that-name",
      switches: OFF,
    });
    expect(sent.state).toBe("pending_out");
  });

  it("a request whose send failed stays pending (the answer may be what was lost) and can be sent again", async () => {
    const { anna, ben, benName } = await people();
    // The ping gets through, the request itself does not.
    const real = a.transport.tripShareExchange;
    const spy = jest
      .spyOn(a.transport, "tripShareExchange")
      .mockImplementation((origin, body) =>
        body.kind === "connect-request"
          ? Promise.reject(new a.security.PeerRefusal("timeout"))
          : real(origin, body)
      );
    await expectCode(
      a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF }),
      "SHARE_REMOTE_UNREACHABLE"
    );
    spy.mockRestore();
    expect((await rowOf(a, anna, B)).state).toBe("pending_out");
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
    const again = await a.connections.requestConnection(anna, {
      origin: B,
      username: benName,
      switches: OFF,
    });
    expect(again.state).toBe("pending_out");
    expect(await a.prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(1);
    expect((await rowOf(b, ben, A)).state).toBe("pending_in");
  });

  it("a server the admin has not admitted gets no request, naming it", async () => {
    const { anna, benName } = await people();
    await a.prisma.comparisonPeer.deleteMany({ where: { origin: B } });
    await expect(
      a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF })
    ).rejects.toMatchObject({ code: "SHARE_REMOTE_PEER_NOT_ADMITTED", extra: { origin: B } });
    await pin(a, b);
  });

  it("asking twice for a live connection is refused with its own reason", async () => {
    const { anna, ben, benName } = await people();
    await connect(a, anna, b, ben);
    await expectCode(
      a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF }),
      "SHARE_REMOTE_CONNECTION_EXISTS"
    );
  });

  it("two requests crossing: the greater origin gives way, so exactly one request is left to answer", async () => {
    const { anna, ben, benName } = await people();
    await a.prisma.user.update({ where: { id: anna }, data: { federationFindable: true } });
    const annaName = await nameOf(a, anna);
    // Each server holds its own request, neither has heard of the other's yet.
    const pendingOut = (s: Server, userId: string, origin: string, username: string) =>
      s.prisma.remoteShareAccount.create({
        data: {
          userId,
          origin,
          channel: randomUUID(),
          localChannel: randomUUID(),
          username,
          displayName: username,
          state: "pending_out",
          generation: 1,
        },
      });
    const mineA = await pendingOut(a, anna, B, benName);
    const mineB = await pendingOut(b, ben, A, annaName);
    const message = (to: string, from: string, channel: string) => ({
      kind: "connect-request" as const,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      channel,
      leaderboardChannel: randomUUID(),
      generation: 1,
      toUsername: to,
      fromUsername: from,
      fromDisplayName: from,
      switches: OFF,
    });
    // A's request reaches B, B's reaches A.
    await b.connectionServe.serveConnectRequest(
      A,
      message(benName, annaName, mineA.localChannel),
      B
    );
    await a.connectionServe.serveConnectRequest(
      B,
      message(annaName, benName, mineB.localChannel),
      A
    );
    expect([(await rowOf(a, anna, B)).state, (await rowOf(b, ben, A)).state]).toEqual([
      "pending_out",
      "pending_in",
    ]);
    // B answers the request it holds, and A's pending request completes.
    await b.connections.acceptConnection(ben, mineB.id, OFF);
    expect([(await rowOf(a, anna, B)).state, (await rowOf(b, ben, A)).state]).toEqual([
      "active",
      "active",
    ]);
  });
});

describe("what each switch allows, per direction", () => {
  it("statistics are served only at the owner's level, only on an active connection", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, { asker: { stats: "overview" } });
    // Anna shows Ben her overview; Ben shows Anna nothing.
    expect((await b.remoteStats.readRemoteOverview(ben, onTo, null)).level).toBe("overview");
    await expectCode(
      a.remoteStats.readRemoteOverview(anna, onFrom, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
  });

  it("a trip can be offered only to a person who switched offers on", async () => {
    const { anna, ben, benName } = await people();
    const { onFrom } = await connect(a, anna, b, ben); // Ben's offers: off
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    await expectCode(a.offers.offerTrip(anna, trip.id, onFrom), "SHARE_REMOTE_CONNECTION_REQUIRED");
    // Ben switches offers on: his server announces it, Anna may offer.
    const onB = await rowOf(b, ben, A);
    await b.connections.updateConnectionSwitches(ben, onB.id, { ...OFF, tripOffers: true });
    expect((await a.connectionView.readConnection(anna, onFrom)).theirs.tripOffers).toBe(true);
    await a.offers.offerTrip(anna, trip.id, onFrom);
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(1);
    expect(benName).toBeTruthy();
  });

  it("an offer reaching a person whose offers are off is refused on arrival", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, { target: { tripOffers: true } });
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    // Ben turns offers off here and Anna's server has not heard yet (the announcement is lost).
    await b.prisma.remoteShareAccount.update({
      where: { id: onTo },
      data: { shareTripOffers: false },
    });
    await expect(a.offers.offerTrip(anna, trip.id, onFrom)).rejects.toBeDefined();
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(0);
  });

  it("switches change at once on the owner's side and are announced after", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, { asker: { stats: "full" } });
    expect((await b.remoteStats.readRemoteOverview(ben, onTo, null)).level).toBe("full");
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF });
    await expectCode(
      b.remoteStats.readRemoteOverview(ben, onTo, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    expect((await b.connectionView.readConnection(ben, onTo)).theirs.stats).toBe("off");
  });

  it("a settings message with an older generation changes nothing (stale)", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF, plans: true });
    await a.connections.updateConnectionSwitches(anna, onFrom, {
      ...OFF,
      plans: true,
      stats: "full",
    });
    const onA = await a.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onFrom } });
    const onB = await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onTo } });
    const stale = {
      kind: "connect-settings" as const,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      from: onA.localChannel,
      to: onB.localChannel,
      generation: onB.peerGeneration - 1,
      switches: OFF,
    };
    expect(await b.connectionServe.serveConnectSettings(A, stale)).toEqual({ received: true });
    expect((await b.connectionView.readConnection(ben, onTo)).theirs).toMatchObject({
      plans: true,
      stats: "full",
    });
    // The same generation again is a repeat, also without effect.
    await b.connectionServe.serveConnectSettings(A, {
      ...stale,
      generation: onB.peerGeneration,
      switches: OFF,
    });
    expect((await b.connectionView.readConnection(ben, onTo)).theirs.stats).toBe("full");
  });

  it("a leaderboard switched on while asking and confirming is granted on both sides at once", async () => {
    const { anna, ben } = await people();
    await connect(a, anna, b, ben, { asker: { leaderboard: true }, target: { leaderboard: true } });
    const granted = (s: Server, ownerId: string) =>
      s.prisma.leaderboardConsent.count({ where: { ownerId, status: "accepted" } });
    expect(await granted(a, anna)).toBe(1);
    expect(await granted(b, ben)).toBe(1);
  });

  it("the leaderboard follows the switch through the existing consent", async () => {
    const { anna, ben } = await people();
    const { onFrom } = await connect(a, anna, b, ben);
    const lb = async () =>
      a.prisma.leaderboardConsent.count({ where: { ownerId: anna, status: "accepted" } });
    expect(await lb()).toBe(0);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF, leaderboard: true });
    expect(await lb()).toBe(1);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF });
    expect(await lb()).toBe(0);
  });
});

describe("declining", () => {
  it("is final for 30 days: the same person's next request is dropped without a word, then allowed again", async () => {
    const { anna, ben, benName } = await people();
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    const incoming = await rowOf(b, ben, A);
    await b.connections.declineConnection(ben, incoming.id);
    expect((await rowOf(a, anna, B)).state).toBe("declined");
    expect((await rowOf(b, ben, A)).state).toBe("declined");
    // Anna asks again: she is told "sent", Ben sees nothing.
    const again = await a.connections.requestConnection(anna, {
      origin: B,
      username: benName,
      switches: OFF,
    });
    expect(again.state).toBe("pending_out");
    expect((await rowOf(b, ben, A)).state).toBe("declined");
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(0);
    // Thirty days on, the block is over.
    await b.prisma.remoteShareAccount.update({
      where: { id: incoming.id },
      data: { endedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) },
    });
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    expect((await rowOf(b, ben, A)).state).toBe("pending_in");
  });

  it("asking with a fresh channel does not lift the decline", async () => {
    const { anna, ben, benName } = await people();
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    await b.connections.declineConnection(ben, (await rowOf(b, ben, A)).id);
    // Anna's server lost its row (a restore) and asks with a new channel.
    await a.prisma.remoteShareAccount.deleteMany({ where: { userId: anna } });
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(1);
    expect((await rowOf(b, ben, A)).state).toBe("declined");
  });

  it("the decliner is not blocked from asking the asker", async () => {
    const { anna, ben, benName } = await people();
    await a.prisma.user.update({ where: { id: anna }, data: { federationFindable: true } });
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    await b.connections.declineConnection(ben, (await rowOf(b, ben, A)).id);
    await b.connections.requestConnection(ben, {
      origin: A,
      username: await nameOf(a, anna),
      switches: OFF,
    });
    expect((await rowOf(a, anna, B)).state).toBe("pending_in");
  });
});

describe("ending a connection", () => {
  it("revoke cascades: statistics and leaderboard stop, offers are withdrawn, shared trips keep their copies", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, {
      asker: { stats: "full", leaderboard: true, tripOffers: true },
      target: { stats: "full", tripOffers: true },
    });
    // One trip Ben accepted, one still waiting in his inbox.
    const trip1 = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip1.id);
    await a.offers.offerTrip(anna, trip1.id, onFrom);
    await b.offerInbox.acceptOffer(ben, (await b.offerInbox.listReceivedOffers(ben))[0].id);
    await a.outbox.runDeliveries();
    const trip2 = await a.prisma.trip.create({ data: { userId: anna, name: "Porto" } });
    await addFlight(a, anna, trip2.id);
    await a.offers.offerTrip(anna, trip2.id, onFrom);
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(1);

    await a.connections.endConnection(anna, onFrom);
    await a.outbox.runDeliveries();

    // Both sides are revoked, with every switch off.
    for (const [s, id] of [
      [a, onFrom],
      [b, onTo],
    ] as const) {
      expect(await s.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id } })).toMatchObject({
        state: "revoked",
        statsLevel: "off",
        shareLeaderboard: false,
        shareTripOffers: false,
        remoteSwitches: {},
      });
    }
    // Statistics refuse in both directions, the offer in the inbox is gone, the leaderboard is withdrawn.
    await expectCode(
      b.remoteStats.readRemoteOverview(ben, onTo, null),
      "SHARE_REMOTE_CONNECTION_REQUIRED"
    );
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(0);
    expect(
      await a.prisma.leaderboardConsent.count({ where: { ownerId: anna, status: "accepted" } })
    ).toBe(0);
    // The trip Ben accepted stays his.
    expect(await b.prisma.trip.count({ where: { userId: ben, name: "Lissabon" } })).toBe(1);
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(0);
  });

  it("ending works here even when the other server is down, and nothing keeps being served", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, { asker: { stats: "full" } });
    await b.prisma.comparisonPeer.deleteMany({ where: { origin: A } });
    const ended = await a.connections.endConnection(anna, onFrom);
    expect(ended.state).toBe("revoked");
    await pin(b, a);
    // Ben's server was not told; Anna's refuses all the same.
    expect((await rowOf(b, ben, A)).id).toBe(onTo);
    await expectCode(
      b.remoteStats.readRemoteOverview(ben, onTo, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
  });

  it("taking back a request not yet answered removes it from the other inbox", async () => {
    const { anna, ben, benName } = await people();
    const asked = await a.connections.requestConnection(anna, {
      origin: B,
      username: benName,
      switches: OFF,
    });
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(1);
    await a.connections.endConnection(anna, asked.id);
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(0);
    expect((await rowOf(b, ben, A)).state).toBe("revoked");
  });

  it("a revoked connection can be asked for again", async () => {
    const { anna, ben, benName } = await people();
    const { onFrom } = await connect(a, anna, b, ben);
    await a.connections.endConnection(anna, onFrom);
    await a.connections.requestConnection(anna, { origin: B, username: benName, switches: OFF });
    expect((await rowOf(b, ben, A)).state).toBe("pending_in");
  });
});

describe("pairings from before connections", () => {
  /** An invitation-code pairing, as the migration leaves it: reconfirm. */
  async function oldPairing() {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const { code } = await a.invites.createTripInvite(anna);
    const person = await b.claim.claimTripInvite(ben, code);
    for (const s of [a, b])
      await s.prisma.remoteShareAccount.updateMany({ data: { state: "reconfirm" } });
    return { anna, ben, onB: person.id, onA: (await rowOf(a, anna, B)).id };
  }

  it("reconfirm grants nothing new: no statistics, no new offer", async () => {
    const { anna, ben, onA, onB } = await oldPairing();
    await a.prisma.remoteShareAccount.update({ where: { id: onA }, data: { statsLevel: "full" } });
    await expectCode(
      b.remoteStats.readRemoteOverview(ben, onB, null),
      "SHARE_REMOTE_CONNECTION_REQUIRED"
    );
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await expectCode(a.offers.offerTrip(anna, trip.id, onA), "SHARE_REMOTE_CONNECTION_REQUIRED");
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(0);
  });

  it("is listed to be confirmed, and both confirming makes it active", async () => {
    const { anna, ben, onA, onB } = await oldPairing();
    expect(await b.connectionView.countConnectionRequests(ben)).toBe(1);
    expect((await b.connectionView.readConnection(ben, onB)).state).toBe("reconfirm");
    // Anna confirms: Ben's side becomes a request to answer.
    await a.connections.acceptConnection(anna, onA, { ...OFF, stats: "overview" });
    expect((await rowOf(a, anna, B)).state).toBe("pending_out");
    expect((await rowOf(b, ben, A)).state).toBe("pending_in");
    await b.connections.acceptConnection(ben, onB, { ...OFF, tripOffers: true });
    expect([(await rowOf(a, anna, B)).state, (await rowOf(b, ben, A)).state]).toEqual([
      "active",
      "active",
    ]);
    expect((await b.remoteStats.readRemoteOverview(ben, onB, null)).level).toBe("overview");
  });
});

describe("the old lookup", () => {
  it("directory-pair from a server that still sends it answers paired:false for a findable person", async () => {
    const { ben } = await people();
    const reply = await b.directory.serveDirectoryPair(A, {
      kind: "directory-pair",
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      username: await nameOf(b, ben),
      channel: randomUUID(),
      leaderboardChannel: randomUUID(),
      fromUsername: "anna",
      fromDisplayName: "Anna",
    });
    expect(reply).toMatchObject({ paired: false });
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
  });
});

describe("a restore", () => {
  it("turns live connections back into reconfirm", async () => {
    const { anna, ben } = await people();
    const { onTo } = await connect(a, anna, b, ben, { target: { stats: "full" } });
    await b.restore.suspendTripFederationAfterRestore();
    expect((await b.connectionView.readConnection(ben, onTo)).state).toBe("reconfirm");
  });
});
