/**
 * The people on other servers of one trip, as its page shows them (spec 2026-10-20 §7, phase
 * F-S4c): every remote member of the trip's group with their server and state, and the caller's
 * paired people it can still be offered to. Decided here, before a click, so the page never
 * draws an offer the server would refuse (`offerTrip` checks the same rules).
 */
import { prisma } from "../../../db";
import { acceptedParties, partyKey } from "../members";
import { requireTripFederation } from "./access";
import { ownTripFor } from "./offerBuild";
import { MEMBER_INCLUDE, remoteMemberViews, type RemoteMemberView } from "./remoteMemberView";

export interface OfferablePerson {
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
}

export interface TripRemoteSharing {
  /** The server this trip came from; null when this server is its home (or it is not shared). */
  homeOrigin: string | null;
  members: RemoteMemberView[];
  /** Empty when the trip came from another server: it is offered on from there (F5). */
  offerable: OfferablePerson[];
}

export async function tripRemoteSharing(
  userId: string,
  tripId: string
): Promise<TripRemoteSharing> {
  await requireTripFederation(userId);
  const trip = await ownTripFor(prisma, userId, tripId);
  const group = trip.shareGroupId
    ? await prisma.tripShareGroup.findUnique({ where: { id: trip.shareGroupId } })
    : null;
  // On the receiving server a group's remote member is the home member, reached through each
  // local person's own pairing: the caller sees theirs. The home lists everyone it offered to.
  const rows = group
    ? await prisma.tripShareRemoteMember.findMany({
        where: { groupId: group.id, ...(group.homeOrigin ? { remote: { userId } } : {}) },
        include: MEMBER_INCLUDE,
        orderBy: { createdAt: "asc" },
      })
    : [];
  const members = await remoteMemberViews(rows);
  if (group?.homeOrigin) return { homeOrigin: group.homeOrigin, members, offerable: [] };
  const pairings = await prisma.remoteShareAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  const accepted = await acceptedParties(
    prisma,
    { kind: "user", id: userId },
    pairings.map((p) => ({ kind: "remote", id: p.id }))
  );
  const active = new Set(members.filter((m) => m.state === "active").map((m) => m.remoteId));
  return {
    homeOrigin: null,
    members,
    offerable: pairings
      .filter((p) => accepted.has(partyKey({ kind: "remote", id: p.id })) && !active.has(p.id))
      .map((p) => ({
        remoteId: p.id,
        displayName: p.displayName,
        username: p.username,
        origin: p.origin,
      })),
  };
}
