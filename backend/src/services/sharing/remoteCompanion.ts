/**
 * One person, one companion (2026-11-24). A trip shared with someone on another server showed
 * them twice: the companion the owner had typed ("Norbert Wittke", no link) and the remote
 * member the share brought (norbert@…). A companion can now BE that remote person
 * (`Companion.linkedRemoteId`), and every surface lists a linked person once.
 *
 * The link is the owner's decision. A matching name (`personMatchKey`: case, diacritics, word
 * order folded) only ever produces a question — "Ist das <Name>?" — answered with link or
 * not-link; "not the same" is remembered (`notSameAs`) so it is not asked again.
 */
import { expectingUniqueConflict, prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { mayOfferTripTo } from "../friends/authz";
import {
  canonicalizeCompanionName,
  personMatchKey,
  searchableCompanionName,
} from "../../utils/companionName";

type Db = DbTransaction | typeof prisma;

export interface CompanionRef {
  id: string;
  name: string;
}

export interface NameMatch extends CompanionRef {
  /** On the trip the question is asked for (listed first). */
  onTrip: boolean;
}

export interface RemotePersonRef {
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
}

/** A remote member and an unlinked companion of the same name on the same trip. */
export interface CompanionDuplicate {
  tripId: string;
  tripName: string;
  remote: RemotePersonRef;
  companion: CompanionRef;
}

/** The remote member states in which a person is, or is about to be, on the trip. */
export const ON_TRIP_STATES = ["active", "unreachable", "invited", "suspended"] as const;

export const remoteKey = (remoteId: string): string => `r:${remoteId}`;

const companionNotFound = () => new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");
const remoteNotFound = () =>
  new AppError("No such person on another server", 404, "SHARE_REMOTE_PERSON_NOT_FOUND");

/**
 * The caller's unlinked companions whose name may be `displayName`, those on `tripId` first.
 * A companion the owner already said is not this person (`notKey`) is left out.
 */
export async function nameMatches(
  c: Db,
  userId: string,
  displayName: string,
  opts: { tripId?: string | null; notKey?: string } = {}
): Promise<NameMatch[]> {
  const key = personMatchKey(displayName);
  if (key === "") return [];
  const candidates = await c.companion.findMany({
    where: {
      userId,
      linkedUserId: null,
      linkedRemoteId: null,
      ...(opts.notKey ? { NOT: { notSameAs: { has: opts.notKey } } } : {}),
    },
    select: {
      id: true,
      displayName: true,
      ...(opts.tripId
        ? { trips: { where: { tripId: opts.tripId }, select: { tripId: true } } }
        : {}),
    },
    orderBy: { displayName: "asc" },
  });
  return candidates
    .filter((cand) => personMatchKey(cand.displayName) === key)
    .map((cand) => ({
      id: cand.id,
      name: cand.displayName,
      onTrip: ((cand as { trips?: unknown[] }).trips ?? []).length > 0,
    }))
    .sort((a, b) => Number(b.onTrip) - Number(a.onTrip));
}

/** The companion that IS the remote person `remoteId` for `userId`, if there is one. */
export async function companionOfRemote(
  c: Db,
  userId: string,
  remoteId: string
): Promise<CompanionRef | null> {
  const row = await c.companion.findFirst({
    where: { userId, linkedRemoteId: remoteId },
    select: { id: true, displayName: true },
  });
  return row ? { id: row.id, name: row.displayName } : null;
}

/** Link the caller's companion to the person on another server they are paired with. */
export async function linkRemoteCompanion(
  userId: string,
  companionId: string,
  remoteId: string
): Promise<CompanionRef & { remoteId: string }> {
  const companion = await prisma.companion.findFirst({ where: { id: companionId, userId } });
  if (!companion) throw companionNotFound();
  // Only the caller's own pairing: an id of someone else's answers like one that does not exist.
  const remote = await prisma.remoteShareAccount.findFirst({
    where: { id: remoteId, userId },
    select: { id: true },
  });
  if (!remote) throw remoteNotFound();
  if (companion.linkedUserId) {
    throw new AppError(
      "This companion is already linked to an account",
      409,
      "SHARE_COMPANION_ALREADY_LINKED"
    );
  }
  const other = await prisma.companion.findFirst({
    where: { userId, linkedRemoteId: remoteId, NOT: { id: companionId } },
    select: { id: true, displayName: true },
  });
  if (other) {
    throw new AppError(
      "Another companion is already linked to that person",
      409,
      "SHARE_COMPANION_ALREADY_LINKED",
      undefined,
      { companionId: other.id, companionName: other.displayName }
    );
  }
  let updated;
  try {
    updated = await expectingUniqueConflict("Companion", () =>
      prisma.companion.update({
        where: { id: companion.id },
        data: {
          linkedRemoteId: remoteId,
          notSameAs: companion.notSameAs.filter((k) => k !== remoteKey(remoteId)),
        },
      })
    );
  } catch (error) {
    // Two links at once: the unique index decides, and the loser hears what the check says.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new AppError(
        "Another companion is already linked to that person",
        409,
        "SHARE_COMPANION_ALREADY_LINKED"
      );
    throw error;
  }
  return { id: updated.id, name: updated.displayName, remoteId };
}

/** "Not the same person": remembered, so the same-name question is not asked again. */
export async function markNotSameRemote(
  userId: string,
  companionId: string,
  remoteId: string
): Promise<void> {
  const companion = await prisma.companion.findFirst({ where: { id: companionId, userId } });
  if (!companion) throw companionNotFound();
  const remote = await prisma.remoteShareAccount.findFirst({
    where: { id: remoteId, userId },
    select: { id: true },
  });
  if (!remote) throw remoteNotFound();
  const key = remoteKey(remoteId);
  if (companion.notSameAs.includes(key)) return;
  await prisma.companion.update({
    where: { id: companion.id },
    data: { notSameAs: [...companion.notSameAs, key] },
  });
}

type DuplicateTrip = {
  id: string;
  name: string;
  shareGroupId: string | null;
  companionLinks: {
    companion: {
      id: string;
      displayName: string;
      linkedUserId: string | null;
      linkedRemoteId: string | null;
      notSameAs: string[];
    };
  }[];
};

/** The duplicates on the given trips of `userId` (see `CompanionDuplicate`). */
async function duplicatesOn(
  c: Db,
  userId: string,
  trips: DuplicateTrip[]
): Promise<CompanionDuplicate[]> {
  const groupIds = [...new Set(trips.flatMap((t) => (t.shareGroupId ? [t.shareGroupId] : [])))];
  if (groupIds.length === 0) return [];
  const members = await c.tripShareRemoteMember.findMany({
    where: { groupId: { in: groupIds }, remote: { userId }, state: { in: [...ON_TRIP_STATES] } },
    select: {
      groupId: true,
      remote: { select: { id: true, displayName: true, username: true, origin: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const linkedRemotes = new Set(
    (
      await c.companion.findMany({
        where: { userId, linkedRemoteId: { in: members.map((m) => m.remote.id) } },
        select: { linkedRemoteId: true },
      })
    ).map((row) => row.linkedRemoteId)
  );
  const found: CompanionDuplicate[] = [];
  for (const trip of trips) {
    for (const member of members.filter((m) => m.groupId === trip.shareGroupId)) {
      if (linkedRemotes.has(member.remote.id)) continue;
      const key = personMatchKey(member.remote.displayName);
      const match = trip.companionLinks
        .map((l) => l.companion)
        .find(
          (comp) =>
            !comp.linkedUserId &&
            !comp.linkedRemoteId &&
            !comp.notSameAs.includes(remoteKey(member.remote.id)) &&
            personMatchKey(comp.displayName) === key
        );
      if (!match) continue;
      found.push({
        tripId: trip.id,
        tripName: trip.name,
        remote: {
          remoteId: member.remote.id,
          displayName: member.remote.displayName,
          username: member.remote.username,
          origin: member.remote.origin,
        },
        companion: { id: match.id, name: match.displayName },
      });
    }
  }
  return found;
}

const DUPLICATE_TRIP_SELECT = {
  id: true,
  name: true,
  shareGroupId: true,
  companionLinks: {
    orderBy: { position: "asc" },
    select: {
      companion: {
        select: {
          id: true,
          displayName: true,
          linkedUserId: true,
          linkedRemoteId: true,
          notSameAs: true,
        },
      },
    },
  },
} as const;

/** The duplicates on one of the caller's trips (the share dialog's one-time repair). */
export async function tripCompanionDuplicates(
  userId: string,
  tripId: string
): Promise<CompanionDuplicate[]> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: DUPLICATE_TRIP_SELECT,
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
  return duplicatesOn(prisma, userId, [trip]);
}

/** Every duplicate across the caller's shared trips (the readiness item). */
export async function allCompanionDuplicates(c: Db, userId: string): Promise<CompanionDuplicate[]> {
  const trips = await c.trip.findMany({
    where: { userId, shareGroupId: { not: null } },
    select: DUPLICATE_TRIP_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return duplicatesOn(c, userId, trips);
}

export type SharerCompanionOutcome = "linked" | "created" | "ask" | "skipped";

/**
 * The receiving side (2026-11-24): a trip that arrived from `remote` shows its sharer as a
 * companion. The companion already linked to them is put on the trip; with none, a new linked
 * companion is created — unless an unlinked companion of the same name exists: then nothing is
 * linked on the name alone, and the trip page asks "Ist das <Name>?" instead (`ask`).
 */
export async function placeSharerCompanion(
  tx: DbTransaction,
  userId: string,
  tripId: string,
  remote: { id: string; displayName: string }
): Promise<SharerCompanionOutcome> {
  let companion = await tx.companion.findFirst({
    where: { userId, linkedRemoteId: remote.id },
    select: { id: true, displayName: true },
  });
  let outcome: SharerCompanionOutcome = "linked";
  if (!companion) {
    const asked = await nameMatches(tx, userId, remote.displayName, {
      notKey: remoteKey(remote.id),
    });
    if (asked.length > 0) return "ask";
    const canonicalName = canonicalizeCompanionName(remote.displayName);
    if (canonicalName === "") return "skipped";
    // The same canonical name, already said to be someone else: no second row of that name.
    const taken = await tx.companion.findFirst({
      where: { userId, canonicalName },
      select: { id: true },
    });
    if (taken) return "skipped";
    companion = await tx.companion.create({
      data: {
        userId,
        canonicalName,
        displayName: remote.displayName.trim(),
        searchName: searchableCompanionName(remote.displayName),
        linkedRemoteId: remote.id,
      },
      select: { id: true, displayName: true },
    });
    outcome = "created";
  }
  await attachToTrip(tx, tripId, companion);
  return outcome;
}

/** Put `companion` on the trip (join row and the legacy name array), once. */
export async function attachToTrip(
  tx: DbTransaction,
  tripId: string,
  companion: { id: string; displayName: string }
): Promise<void> {
  const already = await tx.tripCompanion.findFirst({
    where: { tripId, companionId: companion.id },
    select: { tripId: true },
  });
  if (already) return;
  const position = await tx.tripCompanion.count({ where: { tripId } });
  await tx.tripCompanion.create({ data: { tripId, companionId: companion.id, position } });
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { companions: true },
  });
  // A trip's companions are private, never a shared fact (facts/trip.ts): nothing propagates.
  await tx.trip.update({
    where: { id: tripId },
    data: { companions: [...trip.companions, companion.displayName] },
  });
}

/**
 * The same for a share between two accounts of this server: the sharer's linked companion is put
 * on the recipient's new trip, or created linked — only where the recipient may link to the
 * sharer at all (their consent, `mayOfferTripTo`), and never over an unlinked same-name companion.
 */
export async function placeLocalSharerCompanion(
  tx: DbTransaction,
  recipientId: string,
  tripId: string,
  sharer: { id: string; displayName: string }
): Promise<SharerCompanionOutcome> {
  const linked = await tx.companion.findFirst({
    where: { userId: recipientId, linkedUserId: sharer.id },
    select: { id: true, displayName: true },
  });
  if (linked) {
    await attachToTrip(tx, tripId, linked);
    return "linked";
  }
  if (!(await mayOfferTripTo(tx, recipientId, sharer.id))) return "skipped";
  const asked = await nameMatches(tx, recipientId, sharer.displayName, {
    notKey: `u:${sharer.id}`,
  });
  if (asked.length > 0) return "ask";
  const canonicalName = canonicalizeCompanionName(sharer.displayName);
  if (canonicalName === "") return "skipped";
  if (await tx.companion.findFirst({ where: { userId: recipientId, canonicalName } }))
    return "skipped";
  const created = await tx.companion.create({
    data: {
      userId: recipientId,
      canonicalName,
      displayName: sharer.displayName.trim(),
      searchName: searchableCompanionName(sharer.displayName),
      linkedUserId: sharer.id,
    },
    select: { id: true, displayName: true },
  });
  await attachToTrip(tx, tripId, created);
  return "created";
}
