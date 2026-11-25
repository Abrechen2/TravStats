/**
 * One person, one companion (2026-11-24), across two servers. Measured on prod: a trip shared
 * with a father's account on another server listed him twice on the sharer's side (the typed
 * companion and the remote member), and arrived on his side with no companions and nobody told.
 */
import { unlinkCompanion } from "../../companionLink";
import { offerAndAccept, pairAcross } from "./sharedTripFixtures";
import { servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

/** Anna's trip on A with her own, unlinked companion `companionName`. */
async function tripWithCompanion(anna: string, companionName: string) {
  const trip = await a.prisma.trip.create({
    data: { userId: anna, name: "Antarktis 2027", companions: [companionName] },
  });
  const companion = await a.prisma.companion.create({
    data: {
      userId: anna,
      canonicalName: companionName.toLowerCase(),
      displayName: companionName,
      searchName: companionName.toLowerCase(),
    },
  });
  await a.prisma.tripCompanion.create({
    data: { tripId: trip.id, companionId: companion.id, position: 0 },
  });
  return { trip, companion };
}

describe("the sharer's side", () => {
  it("a same-name companion is only asked about, never linked on its own", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    // "ben" folds to the remote's display name "Ben" (case, accents, word order).
    const { trip, companion } = await tripWithCompanion(anna, "bén");
    await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

    const [member] = (await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id)).members;
    expect(member.companion).toBeNull();
    expect(member.nameMatches).toEqual([{ id: companion.id, name: "bén", onTrip: true }]);
    expect(
      (await a.prisma.companion.findUniqueOrThrow({ where: { id: companion.id } })).linkedRemoteId
    ).toBeNull();
    const duplicates = await a.remoteCompanion.tripCompanionDuplicates(anna, trip.id);
    expect(duplicates.map((d) => [d.companion.id, d.remote.remoteId])).toEqual([
      [companion.id, remote.id],
    ]);
    expect(await a.remoteCompanion.allCompanionDuplicates(a.prisma, anna)).toHaveLength(1);
  });

  it("the duplicate is listed once after linking, and unlinking brings the question back", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const { trip, companion } = await tripWithCompanion(anna, "Ben");
    await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

    await a.remoteCompanion.linkRemoteCompanion(anna, companion.id, remote.id);
    const [member] = (await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id)).members;
    expect(member.companion).toEqual({ id: companion.id, name: "Ben" });
    expect(member.nameMatches).toEqual([]);
    expect(await a.remoteCompanion.tripCompanionDuplicates(anna, trip.id)).toEqual([]);

    // A second companion cannot claim the same person.
    const other = await a.prisma.companion.create({
      data: { userId: anna, canonicalName: "ben t", displayName: "Ben T", searchName: "ben t" },
    });
    await expect(
      a.remoteCompanion.linkRemoteCompanion(anna, other.id, remote.id)
    ).rejects.toMatchObject({ code: "SHARE_COMPANION_ALREADY_LINKED" });

    // The harness's A runs on the default module graph, so this unlink is A's.
    await unlinkCompanion(anna, companion.id);
    expect(await a.remoteCompanion.tripCompanionDuplicates(anna, trip.id)).toHaveLength(1);
  });

  it("'not the same person' is remembered and ends the question and the repair item", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const { trip, companion } = await tripWithCompanion(anna, "Ben");
    await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

    await a.remoteCompanion.markNotSameRemote(anna, companion.id, remote.id);
    const [member] = (await a.tripRemoteSharing.tripRemoteSharing(anna, trip.id)).members;
    expect(member.nameMatches).toEqual([]);
    expect(await a.remoteCompanion.tripCompanionDuplicates(anna, trip.id)).toEqual([]);
  });

  it("someone else's pairing cannot be linked to the caller's companion", async () => {
    const anna = await user(a, "Anna");
    const carl = await user(a, "Carl");
    const ben = await user(b, "Ben");
    const carlsPairing = await pairAcross(a, carl, b, ben);
    const { companion } = await tripWithCompanion(anna, "Ben");
    await expect(
      a.remoteCompanion.linkRemoteCompanion(anna, companion.id, carlsPairing.id)
    ).rejects.toMatchObject({ code: "SHARE_REMOTE_PERSON_NOT_FOUND" });
  });
});

describe("the recipient's side", () => {
  it("an arrived trip names its sharer as a linked companion, and says it arrived", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Antarktis 2027" } });
    await a.offers.offerTrip(anna, trip.id, remote.id);

    // Waiting for an answer: in the banner list and counted.
    const waiting = await b.receivedTrips.receivedTrips(ben);
    expect(waiting.items.map((i) => [i.kind, i.tripName, i.from.displayName])).toEqual([
      ["offer", "Antarktis 2027", "Anna"],
    ]);
    const [offer] = await b.offerInbox.listReceivedOffers(ben);
    const { tripId } = await b.offerInbox.acceptOffer(ben, offer.id);

    const pairingOnB = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: ben, origin: a.origin },
    });
    const links = await b.prisma.tripCompanion.findMany({
      where: { tripId },
      include: { companion: true },
    });
    expect(links.map((l) => [l.companion.displayName, l.companion.linkedRemoteId])).toEqual([
      ["Anna", pairingOnB.id],
    ]);
    expect((await b.prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).companions).toEqual([
      "Anna",
    ]);
    const [member] = (await b.tripRemoteSharing.tripRemoteSharing(ben, tripId)).members;
    expect(member.companion?.name).toBe("Anna");

    const arrived = await b.receivedTrips.receivedTrips(ben);
    expect(arrived.items.map((i) => [i.kind, i.tripId, i.autoAccepted])).toEqual([
      ["shared", tripId, false],
    ]);
    await b.receivedTrips.markReceivedTripsSeen(ben);
    expect((await b.receivedTrips.receivedTrips(ben)).count).toBe(0);
  });

  it("an existing same-name companion on the recipient's server is asked about, not linked", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const remote = await pairAcross(a, anna, b, ben);
    const own = await b.prisma.companion.create({
      data: { userId: ben, canonicalName: "anna", displayName: "Anna", searchName: "anna" },
    });
    const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Antarktis 2027" } });
    const benTrip = await offerAndAccept(a, anna, trip.id, remote.id, b, ben);

    expect(await b.prisma.tripCompanion.count({ where: { tripId: benTrip } })).toBe(0);
    expect(
      (await b.prisma.companion.findUniqueOrThrow({ where: { id: own.id } })).linkedRemoteId
    ).toBeNull();
    const [member] = (await b.tripRemoteSharing.tripRemoteSharing(ben, benTrip)).members;
    expect(member.nameMatches.map((m) => m.id)).toEqual([own.id]);
  });
});
