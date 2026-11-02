/**
 * The simplified federation setup (owner direction 2026-10-26, forgejo#301) across two servers:
 * server-level trust instead of per-person codes — a findable person is looked up and paired, the
 * leaderboard and statistics switches default off, and every refusal has its own reason.
 */
import { serveAggregate } from "../../../comparison/peerActions";
import { A, B, pin, servers, user, useTwoServers, type Server } from "./twoServerHarness";
import { addFlight } from "./sharedTripFixtures";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const expectRefusal = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

const makeFindable = (s: Server, userId: string, findable = true) =>
  s.prisma.user.update({ where: { id: userId }, data: { federationFindable: findable } });

async function usernameOf(s: Server, userId: string): Promise<string> {
  return (await s.prisma.user.findUniqueOrThrow({ where: { id: userId } })).username;
}

/** Anna on A, a findable Ben on B, found by Anna. */
async function annaFindsBen() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  await makeFindable(b, ben);
  const person = await a.directory.findRemotePerson(anna, B, await usernameOf(b, ben));
  return { anna, ben, person };
}

describe("finding a person on a connected server", () => {
  it("pairs both sides without a code: trip pairing, offer consents and a leaderboard pairing, everything off", async () => {
    const { anna, ben, person } = await annaFindsBen();
    expect(person).toMatchObject({
      origin: B,
      displayName: "Ben",
      consent: "accepted",
      statsLevel: "off",
      leaderboard: "off",
    });
    const onA = await a.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: anna, origin: B },
      include: { leaderboardRemote: true, consentsTargeted: true },
    });
    const onB = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: ben, origin: A },
      include: { leaderboardRemote: true, consentsRequested: true },
    });
    expect(onA).toMatchObject({ channel: onB.localChannel, localChannel: onB.channel });
    expect(onA.leaderboardRemote?.channel).toBe(onB.leaderboardRemote?.channel);
    expect(onA.consentsTargeted[0]).toMatchObject({ requesterId: anna, status: "accepted" });
    expect(onB.consentsRequested[0]).toMatchObject({ targetId: ben, status: "accepted" });
    // Nothing is shared by pairing: no leaderboard consent on either side, statistics off.
    expect(await a.prisma.leaderboardConsent.count({ where: { ownerId: anna } })).toBe(0);
    expect(await b.prisma.leaderboardConsent.count({ where: { ownerId: ben } })).toBe(0);
    expect(onB.statsLevel).toBe("off");
  });

  it("answers an unknown name and a person who is not findable alike, and writes nothing", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben"); // findable stays at its default: off
    const quiet = await a.directory
      .findRemotePerson(anna, B, await usernameOf(b, ben))
      .catch((e: unknown) => e);
    const unknown = await a.directory
      .findRemotePerson(anna, B, "nobody-by-that-name")
      .catch((e: unknown) => e);
    for (const error of [quiet, unknown])
      expect(error).toMatchObject({ code: "SHARE_REMOTE_PERSON_UNKNOWN" });
    expect((quiet as Error).message).toBe((unknown as Error).message);
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
    expect(await a.prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(0);
  });

  it("a deactivated person is not found even when they opted in", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    await makeFindable(b, ben);
    await b.prisma.user.update({ where: { id: ben }, data: { isActive: false } });
    await expectRefusal(
      a.directory.findRemotePerson(anna, B, await usernameOf(b, ben)),
      "SHARE_REMOTE_PERSON_UNKNOWN"
    );
  });

  it("refuses a server this server's admin has not admitted, naming it", async () => {
    const anna = await user(a, "Anna");
    await a.prisma.comparisonPeer.deleteMany({ where: { origin: B } });
    await expect(a.directory.findRemotePerson(anna, B, "ben")).rejects.toMatchObject({
      code: "SHARE_REMOTE_PEER_NOT_ADMITTED",
      extra: { origin: B },
    });
    await pin(a, b); // put back for the other tests of this file
  });

  it("is refused by the other server when its admin has not admitted this one", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    await makeFindable(b, ben);
    await b.prisma.comparisonPeer.deleteMany({ where: { origin: A } });
    await expectRefusal(
      a.directory.findRemotePerson(anna, B, await usernameOf(b, ben)),
      "SHARE_REMOTE_UNREACHABLE"
    );
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
    await pin(b, a);
  });

  it("is limited per peer: guessing names runs into its own reason", async () => {
    const anna = await user(a, "Anna");
    for (let i = 0; i < b.directory.DIRECTORY_LOOKUPS_PER_HOUR; i++)
      expect(b.directory.takeDirectoryLookup(A)).toBe(true);
    await expectRefusal(
      a.directory.findRemotePerson(anna, B, "anyone"),
      "SHARE_REMOTE_LOOKUP_LIMITED"
    );
  });

  it("does not revive a consent the person withdrew: the lookup answers like an unknown name", async () => {
    const { anna, ben, person } = await annaFindsBen();
    const onB = await b.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: ben } });
    await b.lifecycle.withdrawRemoteConsent(ben, onB.id);
    await expectRefusal(
      a.directory.findRemotePerson(anna, B, person.username),
      "SHARE_REMOTE_PERSON_UNKNOWN"
    );
    expect(
      (await b.prisma.shareConsent.findFirstOrThrow({ where: { targetId: ben } })).status
    ).toBe("withdrawn");
  });

  it("a second lookup reuses the pairing instead of making another", async () => {
    const { anna, ben, person } = await annaFindsBen();
    const again = await a.directory.findRemotePerson(anna, B, person.username);
    expect(again.id).toBe(person.id);
    expect(await a.prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(1);
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(1);
    expect(await b.prisma.leaderboardRemote.count({ where: { userId: ben } })).toBe(1);
  });

  it("when both look each other up, one pairing results on each side", async () => {
    const { anna, ben } = await annaFindsBen();
    await makeFindable(a, anna);
    const back = await b.directory.findRemotePerson(ben, A, await usernameOf(a, anna));
    expect(back.origin).toBe(A);
    expect(await a.prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(1);
    expect(await b.prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(1);
    const onA = await a.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: anna } });
    const onB = await b.prisma.remoteShareAccount.findFirstOrThrow({ where: { userId: ben } });
    expect(onA.channel).toBe(onB.localChannel);
    expect(onA.localChannel).toBe(onB.channel);
  });
});

describe("the leaderboard switch of one remote person", () => {
  it("shares the totals only while it is on, through the existing leaderboard consent", async () => {
    const { anna, person } = await annaFindsBen();
    // Ben's server asks Anna's, as `pullRemote` does, by the channel both leaderboard rows share.
    const askA = async () => {
      const onA = await a.prisma.leaderboardRemote.findFirstOrThrow({ where: { userId: anna } });
      return serveAggregate(B, {
        action: "aggregate",
        channel: onA.channel,
        year: null,
        accept: [1],
      });
    };
    expect((await askA()).status).toBe("notShared");
    const on = await a.remoteStats.setRemoteLeaderboard(anna, person.id, true);
    expect(on.leaderboard).toBe("on");
    expect((await askA()).status).toBe("ok");
    await a.remoteStats.setRemoteLeaderboard(anna, person.id, false);
    expect((await askA()).status).toBe("withdrawn");
  });

  it("is unavailable for a pairing made with an invitation code", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const { code } = await a.invites.createTripInvite(anna);
    const person = await b.claim.claimTripInvite(ben, code);
    expect(person.leaderboard).toBe("unavailable");
    await expectRefusal(
      b.remoteStats.setRemoteLeaderboard(ben, person.id, true),
      "SHARE_REMOTE_LEADERBOARD_UNAVAILABLE"
    );
  });
});

describe("the statistics level of one remote person", () => {
  async function annaWithFlight() {
    const found = await annaFindsBen();
    const flight = await addFlight(a, found.anna, (await tripOf(found.anna)).id);
    // Private fields that must never appear on the wire.
    await a.prisma.flight.update({
      where: { id: flight.id },
      data: { notes: "SECRET-NOTE", price: 987.65, seatNumber: "12F" },
    });
    // Ben reads Anna: Ben's pairing is the one named by `found.person`'s mirror.
    const benPairing = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: found.ben, origin: A },
    });
    const annaPairing = found.person;
    return { ...found, benPairing, annaPairing };
  }
  const tripOf = (userId: string) => a.prisma.trip.create({ data: { userId, name: "Lissabon" } });

  it("off (the default): Ben is told it is not shared, entries and totals alike", async () => {
    const { ben, benPairing } = await annaWithFlight();
    await expectRefusal(
      b.remoteStats.readRemoteOverview(ben, benPairing.id, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    await expectRefusal(
      b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
  });

  it("Übersicht: totals reach Ben, but not one entry — and no private field", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    // Anna sets the level on HER row of Ben; Ben reads through the row that mirrors it.
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "overview");
    const overview = await b.remoteStats.readRemoteOverview(ben, benPairing.id, null);
    expect(overview.level).toBe("overview");
    expect(overview.snapshot.metrics).toBeDefined();
    await expectRefusal(
      b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    expect(JSON.stringify(overview)).not.toMatch(/SECRET-NOTE|987\.65|12F|TP571/);
  });

  it("Voll: the entries behind the figures arrive as fact lists, without notes, costs or seat", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "full");
    const page = await b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0);
    expect(page.total).toBe(1);
    expect(page.entries[0].facts).toMatchObject({ flightNumber: "TP571", depIata: "FRA" });
    const wire = JSON.stringify(page);
    expect(wire).not.toMatch(/SECRET-NOTE|987\.65|12F|notes|price|seatNumber/);
    // The key is random per read, never the entry's share key or id.
    const again = await b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0);
    expect(again.entries[0].shareKey).not.toBe(page.entries[0].shareKey);
  });

  it("withdrawing the person ends what was shown, at once", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "full");
    await a.remoteStats.setRemoteLeaderboard(anna, annaPairing.id, true);
    await a.lifecycle.withdrawRemoteConsent(anna, annaPairing.id);
    await expectRefusal(
      b.remoteStats.readRemoteOverview(ben, benPairing.id, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    const row = await a.prisma.remoteShareAccount.findUniqueOrThrow({
      where: { id: annaPairing.id },
    });
    expect(row.statsLevel).toBe("off");
  });

  it("an unpinned server cannot read: the peer is refused before any pairing is looked at", async () => {
    const { ben, benPairing } = await annaWithFlight();
    await b.prisma.comparisonPeer.deleteMany({ where: { origin: A } });
    await expectRefusal(
      b.remoteStats.readRemoteOverview(ben, benPairing.id, null),
      "SHARE_REMOTE_PEER_NOT_ADMITTED"
    );
    await pin(b, a);
  });
});

describe("a trip offered to a person on a connected server", () => {
  it("looks the person up, offers the trip, and the person answers in their inbox", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    await makeFindable(b, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    const member = await a.offerByName.offerTripTo(anna, trip.id, {
      origin: B,
      username: await usernameOf(b, ben),
    });
    expect(member).toMatchObject({ state: "invited", origin: B });
    const offers = await b.offerInbox.listReceivedOffers(ben);
    expect(offers).toHaveLength(1);
    // Nothing is in Ben's account before he answers.
    expect(await b.prisma.trip.count({ where: { userId: ben } })).toBe(0);
  });

  it("a person who is not findable is refused with the lookup's reason, and no offer leaves", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await expectRefusal(
      a.offerByName.offerTripTo(anna, trip.id, { origin: B, username: await usernameOf(b, ben) }),
      "SHARE_REMOTE_PERSON_UNKNOWN"
    );
    expect(await b.offerInbox.listReceivedOffers(ben)).toHaveLength(0);
  });
});
