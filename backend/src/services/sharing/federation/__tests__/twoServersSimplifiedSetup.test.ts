/**
 * The simplified federation setup (owner direction 2026-10-26, forgejo#301) across two servers:
 * server-level trust instead of per-person codes — since 2026-11-02 a findable person is asked for
 * a connection and confirms it (`twoServersConnections.test.ts` covers the handshake); this file
 * keeps what a connection then carries: the leaderboard and statistics switches, what ends with
 * it, and offers by name.
 */
import { serveAggregate } from "../../../comparison/peerActions";
import { A, B, connect, pin, servers, user, useTwoServers, type Server } from "./twoServerHarness";
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

/** Anna on A asks a findable Ben on B, who confirms with every switch off (Ben accepts offers). */
async function annaFindsBen() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const { onFrom } = await connect(a, anna, b, ben, { target: { tripOffers: true } });
  const person = { id: onFrom, username: await usernameOf(b, ben) };
  return { anna, ben, person };
}

describe("what a pairing showed ends with the pairing", () => {
  /** Ben shows Anna his totals and his full statistics. */
  async function benShowsAnna() {
    const found = await annaFindsBen();
    const benRow = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: found.ben, origin: A },
    });
    await b.remoteStats.setStatsLevel(found.ben, benRow.id, "full");
    await b.remoteStats.setRemoteLeaderboard(found.ben, benRow.id, true);
    const lb = await b.prisma.leaderboardRemote.findFirstOrThrow({ where: { userId: found.ben } });
    // The served state, read on Ben's server: only an accepted consent is ever served.
    const asked = async () => ({
      status: (await b.prisma.leaderboardConsent.findFirstOrThrow({ where: { remoteId: lb.id } }))
        .status,
    });
    return { ...found, benRow, asked };
  }

  it("an incoming revoke withdraws the leaderboard consent and the level too", async () => {
    const { anna, ben, person, benRow, asked } = await benShowsAnna();
    expect((await asked()).status).toBe("accepted");
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    await a.offers.offerTrip(anna, trip.id, person.id);
    const offer = (await b.offerInbox.listReceivedOffers(ben))[0];
    await b.offerInbox.acceptOffer(ben, offer.id);
    await a.outbox.runDeliveries();
    // Anna withdraws; her server revokes at Ben's.
    await a.lifecycle.withdrawRemoteConsent(anna, person.id);
    await a.outbox.runDeliveries();
    expect((await asked()).status).toBe("withdrawn");
    expect(
      (await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: benRow.id } })).statsLevel
    ).toBe("off");
  });

  it("a restore withdraws the leaderboard consent and resets the level", async () => {
    const { benRow, asked } = await benShowsAnna();
    expect((await asked()).status).toBe("accepted");
    await b.restore.suspendTripFederationAfterRestore();
    expect((await asked()).status).toBe("withdrawn");
    expect(
      (await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: benRow.id } })).statsLevel
    ).toBe("off");
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

  it("a domain the owner hid has no entries to show, and its totals are left out", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "full");
    expect((await b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0)).total).toBe(1);
    await a.prisma.userSettings.upsert({
      where: { userId: anna },
      create: { userId: anna, data: {}, enabledDomains: ["cruise"] },
      update: { enabledDomains: ["cruise"] },
    });
    await expectRefusal(
      b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    const overview = await b.remoteStats.readRemoteOverview(ben, benPairing.id, null);
    expect(overview.snapshot.domains).not.toContain("flight");
  });

  it("the viewer's own hidden domains are not shown either", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "full");
    await b.prisma.userSettings.upsert({
      where: { userId: ben },
      create: { userId: ben, data: {}, enabledDomains: ["cruise"] },
      update: { enabledDomains: ["cruise"] },
    });
    await expectRefusal(
      b.remoteStats.readRemoteEntries(ben, benPairing.id, "flight", 0),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
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

  it("a pairing whose consent is not a yes shows nothing, whatever level it still holds", async () => {
    const { anna, ben, benPairing, annaPairing } = await annaWithFlight();
    await a.remoteStats.setStatsLevel(anna, annaPairing.id, "full");
    // As after a restore (consent back to pending) or a revoke from the other side.
    await a.prisma.shareConsent.updateMany({
      where: {
        OR: [
          { requesterId: anna, remoteTargetId: annaPairing.id },
          { remoteRequesterId: annaPairing.id, targetId: anna },
        ],
      },
      data: { status: "pending" },
    });
    await expectRefusal(
      b.remoteStats.readRemoteOverview(ben, benPairing.id, null),
      "SHARE_REMOTE_STATS_NOT_SHARED"
    );
    await expectRefusal(
      a.remoteStats.setStatsLevel(anna, annaPairing.id, "overview"),
      "SHARE_REMOTE_CONSENT_MISSING"
    );
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
  it("offers the trip by name to a connected person, who answers in their inbox", async () => {
    const { anna, ben } = await annaFindsBen();
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await addFlight(a, anna, trip.id);
    const member = await a.offerByName.offerTripTo(anna, trip.id, {
      origin: B,
      username: await usernameOf(b, ben),
    });
    expect(member).toMatchObject({ state: "invited", origin: B });
    const offers = await b.offerInbox.listReceivedOffers(ben);
    expect(offers).toHaveLength(1);
    // The inbox badge counts exactly the offers the list shows (forgejo#404 contract).
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(1);
    // Nothing is in Ben's account before he answers.
    expect(await b.prisma.trip.count({ where: { userId: ben } })).toBe(0);
  });

  it("a person without a confirmed connection is refused with its own reason, and no offer leaves", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    await makeFindable(b, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
    await expectRefusal(
      a.offerByName.offerTripTo(anna, trip.id, { origin: B, username: await usernameOf(b, ben) }),
      "SHARE_REMOTE_CONNECTION_REQUIRED"
    );
    expect(await b.offerInbox.listReceivedOffers(ben)).toHaveLength(0);
    expect(await b.offerInbox.countReceivedOffers(ben)).toBe(0);
  });
});
