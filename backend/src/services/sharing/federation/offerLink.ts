import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { Prisma } from "../../../prisma";
import {
  MAX_ENTRIES_PER_TRIP,
  offerPreviewReplySchema,
  type OfferPreview,
  type OfferPreviewReply,
} from "../../../schemas/tripSharePeer";
import { exchange } from "../../federation/security";
import { restatusTrips } from "../../trip/restatusTrips";
import { ADAPTERS } from "../adapters";
import { DERIVE } from "../deriveCopy";
import { findByUserKey } from "../keyOps";
import { planLink, type LinkDecision, type LinkPair, type LinkRow } from "../linkMatch";
import {
  describePlan,
  rankCandidates,
  tripRows,
  tripView,
  type LinkTripView,
} from "../linkPreview";
import {
  AWAITING_CONSENT,
  type LinkCandidates,
  type LinkPreviewAnswer,
  type LinkResult,
} from "../linkExisting";
import { acceptedParties } from "../members";
import { propagateWrite, SHARE_TX_TIMEOUT_MS } from "../propagate";
import { placeSharerCompanion } from "../remoteCompanion";
import { SHARE_TYPES, emptyCounts } from "../shareTypes";
import { requireTripFederation } from "./access";
import { ENTRIES_BYTES, wireEntriesOf } from "./entries";
import { remoteShareError } from "./errors";
import { reacceptAfterRestore } from "./lifecycle";
import { answerTo, openOffer, storedOfferSchema, type OpenOffer } from "./offerInbox";
import { refusedThere } from "./offers";
import { LOCAL_ERROR, kindOf, requireAdmitted, unreachable } from "./peerCheck";
import { peerSupports } from "./peerFeatures";
import type { LinkedState } from "./linkState";
import { acceptOfferedRoster } from "./roster";
import { OFFER_PREVIEW_TRANSPORT, messageHeader, wireBytes } from "./transport";
import { fromWireEntries } from "./wire/decode";
import type { WireEntry } from "./wire/shapes";

/**
 * Linking an existing copy across servers (forgejo#440). The person holds a trip of their own
 * and is offered the same trip from another server. Instead of accepting it as a new trip:
 *
 * 1. their server asks the home for the offered entries (`offer-preview`, a read; the home answers
 *    only for an offer still waiting for that pairing) and compares them with the chosen trip —
 *    the dry run, nothing written;
 * 2. on the person's decision the chosen trip joins the group and every matched entry takes the
 *    home's key; the home is answered `accept` as for any accept. Entries only the home holds are
 *    remembered on the membership (`offer.linked.skip`) and never copied when the home sends them
 *    (`serveEntries`): linking creates nothing;
 * 3. after the answer, the decision settles the facts the pairs disagree in: `theirs` writes the
 *    home's values here, `mine` sends this side's values to the home as ordinary fact updates,
 *    `both` changes nothing.
 *
 * If the answer does not arrive, the keys and the group are taken back and the offer waits again.
 */

const NOT_OFFERED: OfferPreviewReply = { kind: "offer-preview-reply", status: "notOffered" };
const TOO_LARGE: OfferPreviewReply = { kind: "offer-preview-reply", status: "tooLarge" };

/** Home: the offered entries, for a pairing whose offer is still waiting for an answer. */
export async function serveOfferPreview(
  origin: string,
  body: OfferPreview
): Promise<OfferPreviewReply> {
  return prisma.$transaction(async (tx) => {
    const group = await tx.tripShareGroup.findFirst({
      where: { federatedRef: body.groupRef, homeOrigin: null },
    });
    if (!group) return NOT_OFFERED;
    const member = await tx.tripShareRemoteMember.findFirst({
      where: {
        groupId: group.id,
        state: "invited",
        remote: { origin, channel: body.from, localChannel: body.to },
      },
      include: { remote: { select: { userId: true } } },
    });
    if (!member) return NOT_OFFERED;
    const trip = await tx.trip.findFirst({
      where: { userId: member.remote.userId, shareGroupId: group.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!trip) return NOT_OFFERED;
    // Read only: the offer keyed the entries already (`buildOfferBody`).
    const entries = await wireEntriesOf(tx, member.remote.userId, trip.id, { assign: false });
    if (entries.length > MAX_ENTRIES_PER_TRIP || wireBytes(entries) > ENTRIES_BYTES)
      return TOO_LARGE;
    return { kind: "offer-preview-reply", status: "ok", entries };
  });
}

/** Spoke: the offered entries from the home, or a refusal the person can read. */
async function fetchOffered(userId: string, row: OpenOffer): Promise<WireEntry[]> {
  const origin = row.remote.origin;
  await requireAdmitted(userId, origin);
  if (!(await peerSupports(origin, "offer-preview").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin },
      { origin }
    );
  let reply: OfferPreviewReply;
  try {
    reply = offerPreviewReplySchema.parse(
      await exchange(
        origin,
        {
          kind: "offer-preview",
          ...messageHeader(),
          groupRef: row.group.federatedRef as string,
          from: row.remote.localChannel,
          to: row.remote.channel,
        },
        OFFER_PREVIEW_TRANSPORT
      )
    );
  } catch (error) {
    const kind = kindOf(error);
    throw kind === LOCAL_ERROR ? error : unreachable(userId, origin, kind);
  }
  if (reply.status === "notOffered")
    throw remoteShareError("SHARE_REMOTE_OFFER_NOT_FOUND", 404, "No such open offer", { userId });
  if (reply.status === "tooLarge")
    throw remoteShareError(
      "SHARE_REMOTE_LINK_TOO_LARGE",
      409,
      "The offered trip has too many entries to compare",
      { userId, origin },
      { origin }
    );
  return reply.entries as WireEntry[];
}

const asDay = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/** The offered trip as the dry run names it (the offer's id stands in for a trip id). */
function offeredTrip(row: OpenOffer): LinkTripView {
  const trip = storedOfferSchema.parse(row.offer).trip;
  return tripView({
    id: row.id,
    name: typeof trip.name === "string" ? trip.name : "",
    startDay: asDay(trip.startDay),
    endDay: asDay(trip.endDay),
  });
}

/** The caller's own trip, outside every share group. */
async function ownUnsharedTrip(c: DbTransaction, userId: string, tripId: string) {
  const trip = await c.trip.findFirst({ where: { id: tripId, userId } });
  if (!trip)
    throw remoteShareError("SHARE_REMOTE_TRIP_NOT_FOUND", 404, "Trip not found", { userId });
  if (trip.shareGroupId)
    throw remoteShareError(
      "SHARE_REMOTE_LINK_TRIP_SHARED",
      409,
      "That trip is already shared; leave its group first",
      { userId }
    );
  return trip;
}

/** The caller's trips that may be the offered one: same period, same name, or overlapping. */
export async function offerLinkCandidates(
  userId: string,
  id: string
): Promise<Extract<LinkCandidates, { access: "full" }>> {
  await requireTripFederation(userId);
  const row = await openOffer(userId, id);
  const trips = await prisma.trip.findMany({
    where: { userId, shareGroupId: null },
    select: { id: true, name: true, startDay: true, endDay: true },
  });
  // The caller's own trips: listed in full.
  const candidates = rankCandidates(offeredTrip(row), trips.map(tripView));
  return { access: "full", candidates };
}

async function planOffer(tx: DbTransaction, userId: string, tripId: string, wire: WireEntry[]) {
  const trip = await ownUnsharedTrip(tx, userId, tripId);
  const here = await tripRows(tx, userId, trip.id);
  const there: LinkRow[] = await fromWireEntries(tx, wire);
  return { trip, here, there, plan: planLink(here, there) };
}

/**
 * The dry run against the offered entries; nothing is written on either server. Before the
 * consent between the two is accepted nothing is read from the home and nothing compared — the
 * answer is `awaitingConsent`, as for a local link.
 */
export async function previewOfferLink(
  userId: string,
  id: string,
  tripId: string
): Promise<LinkPreviewAnswer> {
  await requireTripFederation(userId);
  const row = await openOffer(userId, id);
  const consenting = await acceptedParties(prisma, { kind: "user", id: userId }, [
    { kind: "remote", id: row.remoteId },
  ]);
  if (consenting.size === 0) return AWAITING_CONSENT;
  const wire = await fetchOffered(userId, row);
  return prisma.$transaction(async (tx) => {
    const { trip, here, there, plan } = await planOffer(tx, userId, tripId, wire);
    return {
      access: "full" as const,
      ...describePlan(plan, tripView(trip), offeredTrip(row), here, there),
    };
  });
}

interface Keyed {
  pairs: LinkPair[];
  /** What each keyed entry held before (a stale key, usually none), for the undo. */
  previousKeys: Map<string, string | null>;
  skipped: number;
  alreadyLinked: number;
  onlyHere: number;
  onlyThere: number;
}

/** Give each matched entry here the home's key; false for a key this account holds elsewhere. */
async function keyHere(tx: DbTransaction, userId: string, pair: LinkPair): Promise<boolean> {
  const key = pair.there.shareKey as string;
  const taken = await findByUserKey(tx, SHARE_TYPES[pair.entity].delegate, userId, key);
  if (taken && taken.id !== pair.here.id) return false;
  await ADAPTERS[pair.entity].setKey(tx, pair.here.id, key);
  pair.here.shareKey = key;
  return true;
}

async function linkStructure(
  userId: string,
  row: OpenOffer,
  tripId: string,
  wire: WireEntry[]
): Promise<Keyed> {
  return prisma.$transaction(async (tx) => {
    // Held and read again, as an accept holds it: a second link or accept finds the offer taken.
    await tx.$queryRaw`SELECT 1 FROM trip_share_remote_members WHERE id = ${row.id} FOR UPDATE`;
    const still = await tx.tripShareRemoteMember.findFirst({
      where: { id: row.id, state: row.state, offer: { not: Prisma.DbNull } },
    });
    if (!still)
      throw remoteShareError("SHARE_REMOTE_OFFER_NOT_FOUND", 404, "No such open offer", {
        userId,
      });
    const { trip, plan } = await planOffer(tx, userId, tripId, wire);
    const out: Keyed = {
      pairs: [],
      previousKeys: new Map(),
      skipped: 0,
      alreadyLinked: 0,
      onlyHere: plan.onlyHere.length,
      onlyThere: plan.onlyThere.length,
    };
    for (const pair of plan.pairs) {
      const previous = pair.here.shareKey;
      if (pair.linked) out.alreadyLinked += 1;
      if (await keyHere(tx, userId, pair)) {
        out.pairs.push(pair);
        out.previousKeys.set(pair.here.id, previous);
      } else out.skipped += 1;
    }
    // Taking the trip says yes to the people the offer showed on it, as an accept does (F-S4e).
    await acceptOfferedRoster(
      tx,
      row.groupId,
      userId,
      storedOfferSchema.parse(row.offer).roster.map((r) => r.ref)
    );
    await tx.trip.update({ where: { id: trip.id }, data: { shareGroupId: row.groupId } });
    const skip = plan.onlyThere.flatMap((r) => (r.row.shareKey ? [r.row.shareKey] : []));
    await tx.tripShareRemoteMember.update({
      where: { id: row.id },
      data: {
        state: "active",
        stateReason: null,
        stateSince: new Date(),
        offer: { linked: { tripId: trip.id, skip } } satisfies LinkedState as Prisma.InputJsonValue,
      },
    });
    await tx.shareNotice.create({
      data: {
        userId,
        groupId: row.groupId,
        remoteActorId: row.remoteId,
        kind: "shared",
        entityType: "trip",
        entityKey: trip.id,
        after: {
          tripName: trip.name,
          tripCreated: false,
          created: { ...emptyCounts() },
          linked: { matched: out.pairs.length, decision: null },
          remoteActor: { displayName: row.remote.displayName, origin: row.remote.origin },
        },
      },
    });
    return out;
  });
}

/** The answer did not arrive: keys, group and membership go back to the waiting offer. */
async function undoLink(userId: string, row: OpenOffer, tripId: string, keyed: Keyed) {
  await prisma.$transaction(async (tx) => {
    for (const pair of keyed.pairs)
      await ADAPTERS[pair.entity].setKey(
        tx,
        pair.here.id,
        keyed.previousKeys.get(pair.here.id) ?? null
      );
    await tx.trip.update({ where: { id: tripId }, data: { shareGroupId: null } });
    await tx.shareNotice.deleteMany({ where: { userId, entityType: "trip", entityKey: tripId } });
    await tx.tripShareRemoteMember.update({
      where: { id: row.id },
      data: {
        state: row.state,
        stateReason: row.stateReason,
        stateSince: new Date(),
        offer: row.offer as Prisma.InputJsonValue,
      },
    });
  });
}

/** After the answer: the sharer as a companion, and the decision on the facts. */
async function settleAfterAnswer(
  userId: string,
  row: OpenOffer,
  tripId: string,
  pairs: LinkPair[],
  decision: LinkDecision
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      await placeSharerCompanion(tx, userId, tripId, {
        id: row.remoteId,
        displayName: row.remote.displayName,
      });
      let settled = 0;
      for (const pair of pairs) {
        if (decision === "both" || pair.conflicts.length === 0) continue;
        const { entity, here, there, conflicts } = pair;
        if (decision === "theirs") {
          await ADAPTERS[entity].apply(tx, here, there.facts, conflicts, here.facts);
          await DERIVE[entity](tx, here.id, userId);
        } else {
          // As if the person had just changed these facts from the home's values to their own.
          const homeValues = Object.fromEntries(conflicts.map((k) => [k, there.facts[k]]));
          const before = {
            ...here,
            entity,
            groupId: row.groupId,
            facts: { ...here.facts, ...homeValues },
          };
          await propagateWrite(tx, userId, entity, here.id, before);
        }
        settled += 1;
      }
      await restatusTrips([tripId], tx);
      return settled;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/** Link the offered trip with the caller's own trip; see the file comment. */
export async function linkOffer(
  userId: string,
  id: string,
  tripId: string,
  decision: LinkDecision
): Promise<LinkResult> {
  await requireTripFederation(userId);
  const row = await openOffer(userId, id);
  if (row.state === "suspended") {
    await requireAdmitted(userId, row.remote.origin);
    await reacceptAfterRestore(prisma, userId, row.remoteId);
  }
  const consenting = await acceptedParties(prisma, { kind: "user", id: userId }, [
    { kind: "remote", id: row.remoteId },
  ]);
  if (consenting.size === 0)
    throw remoteShareError(
      "SHARE_REMOTE_CONSENT_MISSING",
      409,
      "No accepted consent with that person",
      { userId, origin: row.remote.origin },
      { origin: row.remote.origin }
    );
  const wire = await fetchOffered(userId, row);
  const keyed = await linkStructure(userId, row, tripId, wire);
  try {
    await answerTo(row, "accept");
  } catch (error) {
    await undoLink(userId, row, tripId, keyed);
    throw refusedThere(userId, row.remote.origin, error);
  }
  // The other server has the answer: the link stands. A failure from here on is reported with the
  // result (`settleFailed`) so the person sees it, instead of an error for a link that happened.
  let settled = 0;
  let settleFailed = false;
  try {
    settled = await settleAfterAnswer(userId, row, tripId, keyed.pairs, decision);
  } catch (error) {
    settleFailed = true;
    logger.error(
      { operation: "share_link_settle_failed", userId, origin: row.remote.origin, error },
      "Linked an offer, but settling the differing facts failed"
    );
  }
  return {
    settleFailed,
    groupId: row.groupId,
    linked: keyed.pairs.length,
    alreadyLinked: keyed.alreadyLinked,
    skipped: keyed.skipped,
    settled,
    onlyHere: keyed.onlyHere,
    onlyThere: keyed.onlyThere,
  };
}
