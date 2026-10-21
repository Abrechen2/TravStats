/**
 * Test helper (not a suite): the shared-trip setups the F-S4e suites repeat — two people paired
 * across two of the harness's servers, a trip with one flight offered, accepted and delivered, a
 * user's own edit through the propagation every write path calls, and the remote members a trip
 * page shows. Works for any home/spoke pair, so the three-server suites use it too.
 */
import { user as harnessUser, type Server } from "./twoServerHarness";

export const MINUTE = 60_000;
export const DAY = 86_400_000;

/** Pair `homeUser` on `home` with `spokeUser` on `spoke`; the home's pairing row. */
export async function pairAcross(home: Server, homeUser: string, spoke: Server, spokeUser: string) {
  const { code } = await home.invites.createTripInvite(homeUser);
  await spoke.claim.claimTripInvite(spokeUser, code);
  return home.prisma.remoteShareAccount.findFirstOrThrow({
    where: { userId: homeUser, origin: spoke.origin },
    orderBy: { createdAt: "desc" },
  });
}

/** Offer `tripId` to the paired person on `spoke`, accept it there, deliver the entries. */
export async function offerAndAccept(
  home: Server,
  homeUser: string,
  tripId: string,
  remoteId: string,
  spoke: Server,
  spokeUser: string
): Promise<string> {
  await home.offers.offerTrip(homeUser, tripId, remoteId);
  const offers = await spoke.offerInbox.listReceivedOffers(spokeUser);
  const offer = offers.find((o) => o.from.origin === home.origin);
  if (!offer) throw new Error("no offer arrived");
  const { tripId: copy } = await spoke.offerInbox.acceptOffer(spokeUser, offer.id);
  await home.outbox.runDeliveries();
  return copy;
}

/** A flight on `tripId` of `userId`, gate A1. */
export const addFlight = (s: Server, userId: string, tripId: string) =>
  s.prisma.flight.create({
    data: {
      userId,
      tripId,
      flightNumber: "TP571",
      depIata: "FRA",
      arrIata: "LIS",
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: new Date("2030-06-01T08:00:00.000Z"),
      depTimezone: "Europe/Berlin",
      gate: "A1",
    },
  });

/** Anna's trip on `home` with one flight, shared with Ben on `spoke` and delivered. */
export async function sharedFlight(home: Server, spoke: Server) {
  const anna = await harnessUser(home, "Anna");
  const ben = await harnessUser(spoke, "Ben");
  const remote = await pairAcross(home, anna, spoke, ben);
  const trip = await home.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
  const flight = await addFlight(home, anna, trip.id);
  const benTrip = await offerAndAccept(home, anna, trip.id, remote.id, spoke, ben);
  const benFlight = await spoke.prisma.flight.findFirstOrThrow({ where: { tripId: benTrip } });
  const groupId = (await home.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } }))
    .shareGroupId as string;
  return { anna, ben, remote, trip, groupId, flight, benTrip, benFlight };
}

/** A user's own edit of a flight, through the propagation every write path calls. */
export async function editFlight(s: Server, userId: string, flightId: string, data: object) {
  await s.prisma.$transaction(async (tx) => {
    const before = await s.propagate.shareSnapshot(tx, "flight", flightId);
    await tx.flight.update({ where: { id: flightId }, data });
    await s.propagate.propagateWrite(tx, userId, "flight", flightId, before);
  });
}

export const gateOf = async (s: Server, id: string) =>
  (await s.prisma.flight.findUniqueOrThrow({ where: { id } })).gate;

/** The remote members `userId`'s trip page shows. */
export const membersOn = async (s: Server, userId: string, tripId: string) =>
  (await s.tripRemoteSharing.tripRemoteSharing(userId, tripId)).members;

export const noticesOf = (s: Server, userId: string, kind?: string) =>
  s.notices.listNotices(userId).then((all) => all.filter((n) => !kind || n.kind === kind));

/**
 * Anna's trip on `a` (the home) with one flight, shared with Ben on `b`, then with Cleo on `c`;
 * every message delivered (F-S4e, three servers).
 */
export async function threeServerTrip(a: Server, b: Server, c: Server) {
  const anna = await harnessUser(a, "Anna");
  const ben = await harnessUser(b, "Ben");
  const cleo = await harnessUser(c, "Cleo");
  const toBen = await pairAcross(a, anna, b, ben);
  const toCleo = await pairAcross(a, anna, c, cleo);
  const trip = await a.prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
  const flight = await addFlight(a, anna, trip.id);
  const benTrip = await offerAndAccept(a, anna, trip.id, toBen.id, b, ben);
  const cleoTrip = await offerAndAccept(a, anna, trip.id, toCleo.id, c, cleo);
  await a.outbox.runDeliveries();
  const flightOn = (s: Server, tripId: string) =>
    s.prisma.flight.findFirstOrThrow({ where: { tripId } });
  return {
    anna,
    ben,
    cleo,
    trip,
    flight,
    benTrip,
    cleoTrip,
    benFlight: await flightOn(b, benTrip),
    cleoFlight: await flightOn(c, cleoTrip),
  };
}
