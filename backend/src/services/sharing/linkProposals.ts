import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { mayOfferTripTo } from "../friends/authz";
import type { BulkPair, BulkPairs } from "./bulkLink";
import { pairTrips } from "./bulkLink";
import { consentRequired } from "./consent";
import type { LinkDecision } from "./linkMatch";
import {
  LINK_TIMEOUT_MS,
  linkInTx,
  ownTripForLink,
  previewInTx,
  type LinkCandidates,
  type LinkResult,
} from "./linkExisting";
import { rankCandidates, tripView, type LinkPreview, type LinkTripView } from "./linkPreview";
import type { LinkChoices } from "./linkSettle";

/**
 * Linking an existing copy on one server, the way an offer from another server is answered
 * (Codex P1, 2026-11-27). A proposes: "I hold this trip and believe you have a copy". Nothing of
 * B's trips is ever shown to A. B sees the proposal in B's own inbox, and only B lists candidates
 * among B's own trips, runs the dry run and links with B's own per-field choices; the bulk link
 * pairs B's open proposals with B's trips. A learns only the status (pending, linked, declined).
 *
 * A proposal needs B's offer consent towards A (`mayOfferTripTo`, asked again at every step) —
 * the same yes an offer needs. It authorises B to read the ONE trip A proposed, nothing else.
 */

const notFound = () =>
  new AppError("No such link proposal", 404, "SHARE_LINK_PROPOSAL_NOT_FOUND", "id");

export type ProposalStatus = "pending" | "linked" | "declined";

export interface SentProposalView {
  id: string;
  tripId: string;
  recipient: { id: string; displayName: string };
  status: ProposalStatus;
}

export interface ReceivedProposalView {
  id: string;
  from: { id: string; displayName: string };
  trip: LinkTripView;
  createdAt: string;
}

const nameOf = (u: { username: string; firstName: string | null }) => u.firstName || u.username;
const PERSON = { select: { id: true, username: true, firstName: true } } as const;
const TRIP = { select: { id: true, name: true, startDay: true, endDay: true } } as const;

/** A's side: propose one of A's own trips to B. Repeating it is harmless; a declined one re-asks. */
export async function proposeLink(
  userId: string,
  tripId: string,
  recipientId: string
): Promise<SentProposalView> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { shareGroup: { select: { homeOrigin: true } } },
  });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");
  if (trip.shareGroup?.homeOrigin)
    throw new AppError(
      "A trip from another server is shared from its home",
      409,
      "SHARE_REMOTE_NOT_HOME"
    );
  const recipient = await prisma.user.findFirst({
    where: { id: recipientId, isActive: true },
    ...PERSON,
  });
  if (!recipient || recipient.id === userId)
    throw new AppError("No such user on this server", 404, "SHARE_USER_NOT_FOUND");
  if (!(await mayOfferTripTo(prisma, userId, recipientId))) throw consentRequired();
  const existing = await prisma.tripLinkProposal.findUnique({
    where: { tripId_recipientId: { tripId, recipientId } },
  });
  const row =
    existing?.status === "linked" || existing?.status === "pending"
      ? existing
      : await prisma.tripLinkProposal.upsert({
          where: { tripId_recipientId: { tripId, recipientId } },
          create: { proposerId: userId, recipientId, tripId },
          update: { status: "pending", decidedAt: null, linkedTripId: null },
        });
  return {
    id: row.id,
    tripId,
    recipient: { id: recipient.id, displayName: nameOf(recipient) },
    status: row.status as ProposalStatus,
  };
}

/** A's side: what A proposed and where it stands — never anything of B's trips. */
export async function sentProposals(userId: string): Promise<SentProposalView[]> {
  const rows = await prisma.tripLinkProposal.findMany({
    where: { proposerId: userId },
    include: { recipient: PERSON },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    tripId: r.tripId,
    recipient: { id: r.recipient.id, displayName: nameOf(r.recipient) },
    status: r.status as ProposalStatus,
  }));
}

/** B's open proposals whose proposer B still lets offer trips. */
async function openProposals(userId: string) {
  const rows = await prisma.tripLinkProposal.findMany({
    where: { recipientId: userId, status: "pending" },
    include: { proposer: PERSON, trip: TRIP },
    orderBy: { createdAt: "desc" },
  });
  const out = [];
  for (const r of rows) if (await mayOfferTripTo(prisma, r.proposerId, userId)) out.push(r);
  return out;
}

/** B's inbox: the trips proposed to B. */
export async function receivedProposals(userId: string): Promise<ReceivedProposalView[]> {
  return (await openProposals(userId)).map((r) => ({
    id: r.id,
    from: { id: r.proposer.id, displayName: nameOf(r.proposer) },
    trip: tripView(r.trip),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function countReceivedProposals(userId: string): Promise<number> {
  return (await openProposals(userId)).length;
}

/** One open proposal to B, its proposer still consenting; anything else is not found. */
async function proposalTo(userId: string, id: string) {
  const row = await prisma.tripLinkProposal.findFirst({
    where: { id, recipientId: userId, status: "pending" },
    include: { trip: true },
  });
  if (!row || !(await mayOfferTripTo(prisma, row.proposerId, userId))) throw notFound();
  return row;
}

/** B's own trips that may be the proposed one. */
export async function proposalCandidates(
  userId: string,
  id: string
): Promise<Extract<LinkCandidates, { access: "full" }>> {
  const p = await proposalTo(userId, id);
  const own = await prisma.trip.findMany({
    where: {
      userId,
      OR: [
        { shareGroupId: null },
        ...(p.trip.shareGroupId ? [{ shareGroupId: p.trip.shareGroupId }] : []),
      ],
    },
    select: TRIP.select,
  });
  return { access: "full", candidates: rankCandidates(tripView(p.trip), own.map(tripView)) };
}

/** B's dry run: B's trip against the proposed one; nothing written. */
export async function previewProposal(
  userId: string,
  id: string,
  tripId: string
): Promise<{ access: "full" } & LinkPreview> {
  const p = await proposalTo(userId, id);
  return prisma.$transaction(async (tx) => {
    const trip = await ownTripForLink(tx, userId, tripId);
    return {
      access: "full" as const,
      ...(await previewInTx(tx, trip, userId, p.proposerId, p.tripId)),
    };
  });
}

/** B links: B's decision and B's per-field choices settle the differences. */
export async function linkProposal(
  userId: string,
  id: string,
  tripId: string,
  decision: LinkDecision,
  choices?: LinkChoices,
  add?: readonly string[]
): Promise<LinkResult> {
  const p = await proposalTo(userId, id);
  return prisma.$transaction(
    async (tx) => {
      // Held: a second link of the same proposal waits and then finds it taken.
      await tx.$queryRaw`SELECT 1 FROM trip_link_proposals WHERE id = ${p.id} FOR UPDATE`;
      const still = await tx.tripLinkProposal.findFirst({ where: { id: p.id, status: "pending" } });
      if (!still) throw notFound();
      const trip = await ownTripForLink(tx, userId, tripId);
      const result = await linkInTx(
        tx,
        trip,
        userId,
        p.proposerId,
        p.tripId,
        decision,
        choices,
        add
      );
      await tx.tripLinkProposal.update({
        where: { id: p.id },
        data: { status: "linked", linkedTripId: trip.id, decidedAt: new Date() },
      });
      return result;
    },
    { timeout: LINK_TIMEOUT_MS }
  );
}

export async function declineProposal(userId: string, id: string): Promise<void> {
  const p = await proposalTo(userId, id);
  await prisma.tripLinkProposal.update({
    where: { id: p.id },
    data: { status: "declined", decidedAt: new Date() },
  });
}

/** B's bulk link: every open proposal paired with one of B's own trips. */
export async function proposalBulkPairs(userId: string): Promise<BulkPairs> {
  const open = await openProposals(userId);
  const own = await prisma.trip.findMany({
    where: { userId, shareGroupId: null },
    select: TRIP.select,
  });
  const views = new Map(open.map((p) => [p.id, { ...tripView(p.trip), id: p.id }]));
  const matched = pairTrips([...views.values()], own.map(tripView));
  const byProposal = new Map(matched.map((m) => [m.source.id, m]));
  const pairs: BulkPair[] = open.map((p) => {
    const m = byProposal.get(p.id);
    return {
      id: p.id,
      trip: m?.target ?? null,
      other: tripView(p.trip),
      reason: m?.reason ?? null,
      linked: false,
      ambiguous: m?.ambiguous ?? false,
      from: { displayName: nameOf(p.proposer), origin: "" },
    };
  });
  return { access: "full", pairs };
}

export interface ProposableTrip extends LinkTripView {
  status: ProposalStatus | null;
}

/**
 * A's bulk side: A's own trips the other person travelled on (a companion linked to their
 * account) — proposed in one run, they arrive in B's inbox. B's trips are never read here.
 */
export async function proposableTrips(
  userId: string,
  recipientId: string
): Promise<ProposableTrip[]> {
  if (!(await mayOfferTripTo(prisma, userId, recipientId))) throw consentRequired();
  const trips = await prisma.trip.findMany({
    where: {
      userId,
      OR: [{ shareGroupId: null }, { shareGroup: { homeOrigin: null } }],
      companionLinks: { some: { companion: { linkedUserId: recipientId } } },
    },
    select: { ...TRIP.select, linkProposals: { where: { recipientId }, select: { status: true } } },
    orderBy: { startDay: "asc" },
  });
  return trips.map((t) => ({
    ...tripView(t),
    status: (t.linkProposals[0]?.status as ProposalStatus | undefined) ?? null,
  }));
}
