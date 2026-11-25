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
import { isHeld } from "./peerMember";
import { rosterView, type RosterPersonView } from "./roster";
import {
  companionOfRemote,
  nameMatches,
  remoteKey,
  type CompanionRef,
  type NameMatch,
} from "../remoteCompanion";

export interface OfferablePerson {
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
}

/**
 * A member as the trip page lists it (one person, one companion, 2026-11-24): the caller's
 * companion that IS this person, or — with none — the caller's unlinked companions whose name
 * may be theirs, for the question "Ist das <Name>?". Never linked on the name alone.
 */
export interface TripRemoteMemberView extends RemoteMemberView {
  companion: CompanionRef | null;
  nameMatches: NameMatch[];
}

export interface TripRemoteSharing {
  /** The server this trip came from; null when this server is its home (or it is not shared). */
  homeOrigin: string | null;
  members: TripRemoteMemberView[];
  /** Everyone on the trip on other servers, and whether their changes reach the caller (F-S4e). */
  roster: RosterPersonView[];
  /** Whether a membership of the caller's on this trip waits for their confirmation (O9). */
  reconfirmable: boolean;
  /** Empty when the trip came from another server: it is offered on from there (F5). */
  offerable: OfferablePerson[];
}

export async function tripRemoteSharing(
  userId: string,
  tripId: string
): Promise<TripRemoteSharing> {
  const identity = await requireTripFederation(userId);
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
  const ownPairing = new Set(rows.filter((r) => r.remote.userId === userId).map((r) => r.remoteId));
  const members: TripRemoteMemberView[] = [];
  for (const view of await remoteMemberViews(rows)) {
    const own = ownPairing.has(view.remoteId);
    const companion = own ? await companionOfRemote(prisma, userId, view.remoteId) : null;
    members.push({
      ...view,
      companion,
      nameMatches:
        own && !companion
          ? await nameMatches(prisma, userId, view.displayName, {
              tripId,
              notKey: remoteKey(view.remoteId),
            })
          : [],
    });
  }
  const roster = group ? await rosterView(userId, group, identity.origin) : [];
  const reconfirmable = rows.some((r) => r.remote.userId === userId && isHeld(r));
  if (group?.homeOrigin)
    return { homeOrigin: group.homeOrigin, members, roster, reconfirmable, offerable: [] };
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
    roster,
    reconfirmable,
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
