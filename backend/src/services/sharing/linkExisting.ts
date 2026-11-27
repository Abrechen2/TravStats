import { randomUUID } from "crypto";

import { prisma, type DbTransaction } from "../../db";
import type { Trip } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { restatusTrips } from "../trip/restatusTrips";
import { ADAPTERS } from "./adapters";
import { consentRequired } from "./consent";
import { recordEntryAuthor } from "./federation/entryAuthors";
import { queueRoster } from "./federation/roster";
import { findByUserKey } from "./keyOps";
import { planLink, type LinkDecision, type LinkPair, type LinkPlan } from "./linkMatch";
import {
  describePlan,
  rankCandidates,
  tripRows,
  tripView,
  type LinkCandidate,
  type LinkPreview,
} from "./linkPreview";
import { settlePair, type LinkChoices } from "./linkSettle";
import { missingGroupConsent } from "./members";
import { SHARE_TYPES, emptyCounts } from "./shareTypes";

/**
 * Linking an existing copy, on one server (forgejo#440): the caller and an account that agreed to
 * sharing already hold the same trip, each their own. Instead of copying the trip again, the two
 * trips join one share group and every pair of entries that is the same journey or stay
 * (`linkMatch.ts`) takes one share key — on both sides. Nothing is created: an entry only one side
 * holds stays where it is, unkeyed, and travels by the ordinary rules once its owner edits it or
 * the trip is shared again.
 *
 * The dry run (`previewLink`) writes nothing; the link (`linkTrip`) applies the caller's decision
 * on the facts the pairs disagree in: `mine` (the caller's values reach the other copy, with an
 * undoable notice there), `theirs` (the other side's values are written onto the caller's entry and
 * spread to any further member), `both` (each keeps their own) or `best` (the bulk link's: the
 * better value wins). No decision lets a worse value overwrite a better one, and the dry run's
 * per-field choices override it (`linkResolve.ts`, UAT 2026-11-27). A repeat links only what is
 * not linked yet; leaving the group (`leaveGroup`, `detach.ts`) undoes it.
 */

const LINK_TX_TIMEOUT_MS = 60_000;

const tripNotFound = () => new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");

export interface LinkResult {
  groupId: string;
  /** Pairs keyed by this call. */
  linked: number;
  /** Pairs that held one key already (a repeat). */
  alreadyLinked: number;
  /** Pairs left alone: the other account holds the key on another entry. */
  skipped: number;
  /** Pairs whose differing facts the decision settled (0 for `both`). */
  settled: number;
  onlyHere: number;
  onlyThere: number;
  /**
   * Across servers only: the link stands (the other server has the answer) but settling the
   * differing facts failed — the person is told and may settle them by hand.
   */
  settleFailed: boolean;
}

/**
 * Before the other account agreed: `{ access: "awaitingConsent" }` and nothing else (kept for the
 * shape of the answer; across servers it still means exactly that).
 */
export const AWAITING_CONSENT = { access: "awaitingConsent" } as const;
export type AwaitingConsent = typeof AWAITING_CONSENT;

/**
 * Codex P1 (2026-11-27): a consent that lets A OFFER trips to B let A list B's unshared trips,
 * read their entries and overwrite them with `mine`. An offer consent authorises incoming offers
 * only. The rule: nothing of B's existing trips is shown to A, and nothing is linked, without B's
 * own decision per trip — the matching runs for B, on B's side, on a trip A proposed. Across
 * servers that is what the offer inbox does (`federation/offerLink.ts`). On one server the
 * proposal needs a record of its own (a schema change, not yet decided), so until it exists the
 * local link answers this refusal for every other account, before anything of theirs is read.
 */
export const localLinkNeedsProposal = () =>
  new AppError(
    "Linking another account's trip needs that account's own decision per trip",
    403,
    "SHARE_LINK_PROPOSAL_REQUIRED"
  );

/** The caller's trip; refused for every other account until local proposals exist (above). */
async function sides(
  c: DbTransaction,
  userId: string,
  tripId: string,
  otherId: string
): Promise<Trip | null> {
  const trip = await c.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) throw tripNotFound();
  const other = await c.user.findFirst({
    where: { id: otherId, isActive: true },
    select: { id: true },
  });
  if (!other) throw new AppError("No such user on this server", 404, "SHARE_USER_NOT_FOUND");
  throw localLinkNeedsProposal();
}

/** `sides`, for the link itself: refused while the other account has not agreed. */
async function agreedSides(c: DbTransaction, userId: string, tripId: string, otherId: string) {
  const trip = await sides(c, userId, tripId, otherId);
  if (!trip) throw consentRequired();
  return trip;
}

/** The other account's trip, which must be in no group or in the caller's. */
async function counterpart(
  c: DbTransaction,
  otherId: string,
  targetTripId: string,
  groupId: string | null
) {
  const target = await c.trip.findFirst({ where: { id: targetTripId, userId: otherId } });
  if (!target) throw tripNotFound();
  if (target.shareGroupId && target.shareGroupId !== groupId)
    throw new AppError(
      "That trip is already shared in another group",
      409,
      "SHARE_TRIP_IN_OTHER_GROUP"
    );
  return target;
}

export type LinkCandidates = { access: "full"; candidates: LinkCandidate[] } | AwaitingConsent;

/** The trips of the other account that may be the caller's trip (same period, name or overlap). */
export async function linkCandidates(
  userId: string,
  tripId: string,
  otherId: string
): Promise<LinkCandidates> {
  return prisma.$transaction(async (tx) => {
    const trip = await sides(tx, userId, tripId, otherId);
    if (!trip) return AWAITING_CONSENT;
    const trips = await tx.trip.findMany({
      where: {
        userId: otherId,
        OR: [
          { shareGroupId: null },
          ...(trip.shareGroupId ? [{ shareGroupId: trip.shareGroupId }] : []),
        ],
      },
      select: { id: true, name: true, startDay: true, endDay: true },
    });
    return {
      access: "full" as const,
      candidates: rankCandidates(tripView(trip), trips.map(tripView)),
    };
  });
}

/** The pair to compare, for a caller the other account agreed to. */
async function planFor(
  tx: DbTransaction,
  trip: { id: string; shareGroupId: string | null },
  userId: string,
  otherId: string,
  targetTripId: string
) {
  const target = await counterpart(tx, otherId, targetTripId, trip.shareGroupId);
  const here = await tripRows(tx, userId, trip.id);
  const there = await tripRows(tx, otherId, target.id);
  return { target, here, there, plan: planLink(here, there) };
}

export type LinkPreviewAnswer = ({ access: "full" } & LinkPreview) | AwaitingConsent;

/** The dry run: what linking would match, what only one side holds, where the facts differ. */
export async function previewLink(
  userId: string,
  tripId: string,
  otherId: string,
  targetTripId: string
): Promise<LinkPreviewAnswer> {
  return prisma.$transaction(async (tx) => {
    const trip = await sides(tx, userId, tripId, otherId);
    if (!trip) return AWAITING_CONSENT;
    const { target, here, there, plan } = await planFor(tx, trip, userId, otherId, targetTripId);
    return {
      access: "full" as const,
      ...describePlan(plan, tripView(trip), tripView(target), here, there),
    };
  });
}

/**
 * Give both entries of a pair one key: the caller's own key when it has one (a trip already
 * shared with someone else), a new one otherwise. False when the other account already holds that
 * key on another entry — the pair is left as it is.
 */
async function keyPair(
  tx: DbTransaction,
  groupId: string,
  userId: string,
  otherId: string,
  pair: LinkPair
) {
  const adapter = ADAPTERS[pair.entity];
  const key = pair.here.shareKey ?? randomUUID();
  const delegate = SHARE_TYPES[pair.entity].delegate;
  const taken = await findByUserKey(tx, delegate, otherId, key);
  if (taken && taken.id !== pair.there.id) return false;
  if (!pair.here.shareKey) {
    await adapter.setKey(tx, pair.here.id, key);
    await recordEntryAuthor(tx, groupId, key, { kind: "user", id: userId });
  }
  await adapter.setKey(tx, pair.there.id, key);
  pair.here.shareKey = key;
  pair.there.shareKey = key;
  return true;
}

/** Link the caller's trip with the other account's copy of it; see the file comment. */
export async function linkTrip(
  userId: string,
  tripId: string,
  otherId: string,
  targetTripId: string,
  decision: LinkDecision,
  choices?: LinkChoices
): Promise<LinkResult> {
  return prisma.$transaction(
    async (tx) => {
      const trip = await agreedSides(tx, userId, tripId, otherId);
      return linkInTx(tx, trip, userId, otherId, targetTripId, decision, choices);
    },
    { timeout: LINK_TX_TIMEOUT_MS }
  );
}

/** The caller's own trip, nothing else checked: for a path that authorised the pair itself. */
export async function ownTripForLink(c: DbTransaction, userId: string, tripId: string) {
  const trip = await c.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip) throw tripNotFound();
  return trip;
}

/** The dry run for a pair a caller is already authorised to compare (a proposal to them). */
export async function previewInTx(
  tx: DbTransaction,
  trip: Trip,
  userId: string,
  otherId: string,
  targetTripId: string
): Promise<LinkPreview> {
  const { target, here, there, plan } = await planFor(tx, trip, userId, otherId, targetTripId);
  return describePlan(plan, tripView(trip), tripView(target), here, there);
}

export const LINK_TIMEOUT_MS = LINK_TX_TIMEOUT_MS;

/** The link for a pair a caller is already authorised to link; see the file comment. */
export async function linkInTx(
  tx: DbTransaction,
  trip: Trip,
  userId: string,
  otherId: string,
  targetTripId: string,
  decision: LinkDecision,
  choices?: LinkChoices
): Promise<LinkResult> {
  const { target, plan } = await planFor(tx, trip, userId, otherId, targetTripId);
  const joining = target.shareGroupId === null;
  let groupId = trip.shareGroupId;
  if (groupId && joining && (await missingGroupConsent(tx, groupId, userId, otherId)).length > 0)
    throw new AppError(
      "Not every member of this trip has agreed to sharing with this account",
      403,
      "SHARE_GROUP_CONSENT_REQUIRED"
    );
  if (!groupId) {
    groupId = (await tx.tripShareGroup.create({ data: { createdById: userId } })).id;
    await tx.trip.update({ where: { id: trip.id }, data: { shareGroupId: groupId } });
  }
  if (joining) await tx.trip.update({ where: { id: target.id }, data: { shareGroupId: groupId } });
  const result = await applyPlan(tx, userId, otherId, groupId, plan, decision, choices);
  await restatusTrips([trip.id, target.id], tx);
  if (joining) {
    await queueRoster(tx, groupId);
    // No companion is put on the other account's EXISTING trip: it is theirs, and a
    // companion they took off must not come back because someone linked a copy (rc46
    // UAT, "Robin Wittke" reappeared). The trip's people section asks them instead.
  }
  if (joining || result.linked > 0) {
    await tx.shareNotice.create({
      data: {
        userId: otherId,
        groupId,
        actorId: userId,
        kind: "shared",
        entityType: "trip",
        entityKey: target.id,
        after: {
          tripName: trip.name,
          tripCreated: false,
          created: { ...emptyCounts() },
          linked: { matched: result.linked + result.alreadyLinked, decision },
          autoAccepted: true,
        },
      },
    });
  }
  return { groupId, ...result };
}

/** Key every unlinked pair, then settle the facts by the decision. */
async function applyPlan(
  tx: DbTransaction,
  userId: string,
  otherId: string,
  groupId: string,
  plan: LinkPlan,
  decision: LinkDecision,
  choices: LinkChoices | undefined
): Promise<Omit<LinkResult, "groupId">> {
  const result = {
    settleFailed: false,
    linked: 0,
    alreadyLinked: 0,
    skipped: 0,
    settled: 0,
    onlyHere: plan.onlyHere.length,
    onlyThere: plan.onlyThere.length,
  };
  const keyed: LinkPair[] = [];
  for (const pair of plan.pairs) {
    if (pair.linked) {
      result.alreadyLinked += 1;
      keyed.push(pair);
    } else if (await keyPair(tx, groupId, userId, otherId, pair)) {
      result.linked += 1;
      keyed.push(pair);
    } else result.skipped += 1;
  }
  // Stops last (registry order), so a stop's wrapped entry is keyed on both sides first.
  for (const pair of keyed)
    if (await settlePair(tx, userId, groupId, pair, decision, choices, { spreadTheirs: true }))
      result.settled += 1;
  return result;
}
