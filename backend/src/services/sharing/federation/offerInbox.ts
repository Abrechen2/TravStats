/**
 * The receiving side of an offer (spec 2026-10-20 §4 `offer` / `offer-answer`, phase F-S4c): an
 * offer waits for the person it names, and only they decide. Until they accept, nothing is in
 * their account — the offer is kept on the member row (`offer`), shown under Einstellungen →
 * Reisen teilen, and a decline copies nothing, ever.
 *
 * Accepting creates the person's own trip from the offered facts BEFORE the answer leaves, so the
 * entries the home server sends right after its acknowledgement always find it. If the answer
 * does not arrive, the trip is taken back — unless entries already reached it, which means the
 * other server did get the answer.
 */
import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import { acceptedParties } from "../members";
import { tripFacts } from "../facts";
import { restatusTrips } from "../../trip/restatusTrips";
import { SHARE_ENTITIES, type CopyCounts } from "../shareTypes";
import { keyedDelegate } from "../keyOps";
import {
  offerCountsSchema,
  rosterEntrySchema,
  type TripOffer,
  type TripShareAck,
} from "../../../schemas/tripSharePeer";
import { z } from "../../../schemas/zod";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { refusedThere } from "./offers";
import { rejectWith, sendOnStream, serveOnce, takeSeq } from "./streams";
import { TRIP_SHARE_TRANSPORT, messageHeader } from "./transport";
import { TRIP_SHAPE, wireTripSchema } from "./wire/shapes";
import { encodeShape } from "./wire/codec";
import { acceptOfferedRoster, storeRoster } from "./roster";

/** What is kept of an offer until it is answered: the wire form, read again on accept. */
const storedOfferSchema = z.object({
  trip: z.record(z.string(), z.unknown()),
  roster: z.array(rosterEntrySchema),
  counts: offerCountsSchema,
  offeredAt: z.string(),
});

/**
 * Record an offer for the person it names (`to`), paired here with the offering member (`from`).
 * Called inside `serveOnce` (the route) or the claim's own write (`claim.ts`).
 */
export async function applyOffer(
  tx: DbTransaction,
  origin: string,
  offer: TripOffer
): Promise<void> {
  const remote = await tx.remoteShareAccount.findFirst({
    where: { origin, channel: offer.from, localChannel: offer.to },
  });
  if (!remote) throw rejectWith("not-member");
  const consenting = await acceptedParties(tx, { kind: "user", id: remote.userId }, [
    { kind: "remote", id: remote.id },
  ]);
  if (consenting.size === 0) throw rejectWith("consent");
  const group =
    (await tx.tripShareGroup.findFirst({
      where: { homeOrigin: origin, federatedRef: offer.groupRef },
    })) ??
    (await tx.tripShareGroup.create({
      data: { homeOrigin: origin, federatedRef: offer.groupRef, createdById: null },
    }));
  await takeSeq(tx, group.id, origin, offer.seq);
  const stored = {
    // Parsed, the facts hold Dates; kept, they are the wire form again, read once more on accept.
    trip: encodeShape(TRIP_SHAPE, offer.trip),
    roster: offer.roster,
    counts: offer.counts,
    offeredAt: offer.sentAt,
  } as unknown as Prisma.InputJsonValue;
  const existing = await tx.tripShareRemoteMember.findUnique({
    where: { groupId_remoteId: { groupId: group.id, remoteId: remote.id } },
  });
  // Already accepted: the trip is theirs; a repeated offer changes nothing.
  if (existing?.state === "active") return;
  const member = await tx.tripShareRemoteMember.upsert({
    where: { groupId_remoteId: { groupId: group.id, remoteId: remote.id } },
    create: { groupId: group.id, remoteId: remote.id, offer: stored },
    update: { state: "invited", stateReason: null, stateSince: new Date(), offer: stored },
  });
  // Who is on the trip, by their refs (F-S4e): the names a relayed change is read by.
  await storeRoster(tx, group.id, member.id, { ...offer, members: offer.roster });
}

export const serveOffer = (origin: string, offer: TripOffer): Promise<TripShareAck> =>
  serveOnce(origin, offer, (tx) => applyOffer(tx, origin, offer));

export interface ReceivedOfferView {
  id: string;
  from: { displayName: string; username: string; origin: string };
  trip: { name: string; startDay: string | null; endDay: string | null };
  roster: { displayName: string; origin: string }[];
  counts: CopyCounts;
  offeredAt: string;
}

const OPEN = (userId: string) => ({
  state: "invited",
  offer: { not: Prisma.DbNull },
  remote: { userId },
  group: { homeOrigin: { not: null } },
});

function offerView(row: {
  id: string;
  offer: Prisma.JsonValue;
  remote: { displayName: string; username: string; origin: string };
}): ReceivedOfferView {
  const offer = storedOfferSchema.parse(row.offer);
  const trip = offer.trip as { name?: unknown; startDay?: unknown; endDay?: unknown };
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: row.id,
    from: row.remote,
    trip: { name: text(trip.name) ?? "", startDay: text(trip.startDay), endDay: text(trip.endDay) },
    roster: offer.roster,
    counts: offer.counts as CopyCounts,
    offeredAt: offer.offeredAt,
  };
}

/** Trips offered to the caller from other servers, waiting for an answer. */
export async function listReceivedOffers(userId: string): Promise<ReceivedOfferView[]> {
  await requireTripFederation(userId);
  const rows = await prisma.tripShareRemoteMember.findMany({
    where: OPEN(userId),
    include: { remote: { select: { displayName: true, username: true, origin: true } } },
    orderBy: { stateSince: "desc" },
  });
  return rows.map(offerView);
}

async function openOffer(userId: string, id: string) {
  const row = await prisma.tripShareRemoteMember.findFirst({
    where: { id, ...OPEN(userId) },
    include: { remote: true, group: true },
  });
  if (!row)
    throw remoteShareError("SHARE_REMOTE_OFFER_NOT_FOUND", 404, "No such open offer", { userId });
  return row;
}

type OpenOffer = Awaited<ReturnType<typeof openOffer>>;

const answerTo = (row: OpenOffer, answer: "accept" | "decline") =>
  sendOnStream(
    row.groupId,
    row.remote.origin,
    (seq) => ({
      kind: "offer-answer",
      ...messageHeader(),
      groupRef: row.group.federatedRef as string,
      seq,
      from: row.remote.localChannel,
      to: row.remote.channel,
      answer,
    }),
    TRIP_SHARE_TRANSPORT
  );

/** Decline: told to the home server first; nothing changes here unless it got the answer. */
export async function declineOffer(userId: string, id: string): Promise<void> {
  await requireTripFederation(userId);
  const row = await openOffer(userId, id);
  try {
    await answerTo(row, "decline");
  } catch (error) {
    throw refusedThere(userId, row.remote.origin, error);
  }
  await prisma.tripShareRemoteMember.update({
    where: { id: row.id },
    data: { state: "declined", offer: Prisma.DbNull, stateSince: new Date() },
  });
}

/** Whether the trip holds anything yet — entries mean the home server had the answer. */
async function holdsEntries(tx: DbTransaction, tripId: string): Promise<boolean> {
  for (const entity of SHARE_ENTITIES) {
    if (await keyedDelegate(tx, entity).findFirst({ where: { tripId }, select: { id: true } }))
      return true;
  }
  return false;
}

/** Accept: the caller's own trip is created now and filled by the entries that follow. */
export async function acceptOffer(userId: string, id: string): Promise<{ tripId: string }> {
  await requireTripFederation(userId);
  const row = await openOffer(userId, id);
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
  const facts = wireTripSchema.parse(storedOfferSchema.parse(row.offer).trip) as Parameters<
    typeof tripFacts
  >[0];
  const tripId = await prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      // The status is the receiver's to derive (rework D4); `restatusTrips` does once filled.
      data: { ...tripFacts(facts), status: "planned", userId, shareGroupId: row.groupId },
      select: { id: true, name: true },
    });
    await tx.tripShareRemoteMember.update({
      where: { id: row.id },
      data: { state: "active", stateReason: null, stateSince: new Date(), offer: Prisma.DbNull },
    });
    await restatusTrips([trip.id], tx);
    // Taking the trip says yes to the people the offer showed on it (F-S4e); anyone who joins
    // later is asked on the trip page before their changes reach this copy.
    await acceptOfferedRoster(
      tx,
      row.groupId,
      userId,
      storedOfferSchema.parse(row.offer).roster.map((r) => r.ref)
    );
    // The trip arrived (F-S4d): told like a local share, naming who it came from and where.
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
          tripCreated: true,
          remoteActor: { displayName: row.remote.displayName, origin: row.remote.origin },
        },
      },
    });
    return trip.id;
  });
  try {
    await answerTo(row, "accept");
  } catch (error) {
    const undone = await prisma.$transaction(async (tx) => {
      // The stream row is the lock `serveEntries` takes first: entries and this undo never mix.
      await tx.$queryRaw`SELECT 1 FROM trip_share_peer_streams
        WHERE group_id = ${row.groupId} AND peer_origin = ${row.remote.origin} FOR UPDATE`;
      if (await holdsEntries(tx, tripId)) return false;
      await tx.shareNotice.deleteMany({ where: { userId, entityType: "trip", entityKey: tripId } });
      await tx.trip.delete({ where: { id: tripId } });
      await tx.tripShareRemoteMember.update({
        where: { id: row.id },
        data: {
          state: "invited",
          stateSince: new Date(),
          offer: row.offer as Prisma.InputJsonValue,
        },
      });
      return true;
    });
    if (undone) throw refusedThere(userId, row.remote.origin, error);
  }
  return { tripId };
}
