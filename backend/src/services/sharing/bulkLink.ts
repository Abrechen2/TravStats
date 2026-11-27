import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { mayOfferTripTo } from "../friends/authz";
import { requireTripFederation } from "./federation/access";
import { offerTrip } from "./federation/offers";
import type { RemoteMemberView } from "./federation/remoteMemberView";
import { offeredTrip } from "./federation/offerLink";
import { listOpenOffers } from "./federation/offerInbox";
import { AWAITING_CONSENT, type AwaitingConsent } from "./linkExisting";
import {
  rankCandidates,
  tripView,
  type LinkCandidateReason,
  type LinkTripView,
} from "./linkPreview";
import { acceptedParties } from "./members";

/**
 * "Alle passenden Reisen verknüpfen" (UAT 2026-11-27): before the owner links his fifty-odd trips
 * with his father's server, one list of every trip pair that is the same trip. This file only
 * pairs trips; the comparison and the link stay the per-pair endpoints (`link-preview`, `link`),
 * which the page calls one pair at a time. That keeps a run rate-limited, resumable (a repeat
 * links nothing twice, and a pair already in one group comes back as `linked`) and every result
 * per pair. Undo is leaving the group (`/trips/:tripId/leave`).
 *
 * Three lists, all after consent only:
 * - local: the caller's trips against another account's on this server;
 * - receiving across servers: the open offers in the caller's inbox against the caller's trips;
 * - sending across servers: the caller's trips the other person travelled on (a companion linked
 *   to them) that are not offered yet — offered in bulk, they arrive in that person's inbox.
 */

export interface BulkPair {
  /** Local: the caller's trip id; receiving across servers: the offer id. */
  id: string;
  /** The caller's own trip; null for an offer with no trip of the caller to match. */
  trip: LinkTripView | null;
  /** The other side's trip (or the offered one). */
  other: LinkTripView;
  reason: LinkCandidateReason | null;
  /** Both trips are in one group already: nothing to do, undo possible. */
  linked: boolean;
  /** Another trip matched as well as this one: the person looks before it is linked. */
  ambiguous: boolean;
  /** Across servers: who offered it. */
  from?: { displayName: string; origin: string };
}

export type BulkPairs = { access: "full"; pairs: BulkPair[] } | AwaitingConsent;

const REASON_RANK: Record<LinkCandidateReason, number> = { period: 0, name: 1, overlap: 2 };

interface Edge {
  source: LinkTripView;
  target: LinkTripView;
  reason: LinkCandidateReason;
}

/**
 * One trip to one trip: the strongest reason first (same period, then same name, then overlap),
 * then the earlier trip. A source with two equally strong targets, or a target two sources want
 * equally, is marked ambiguous — the rule would be guessing.
 */
export function pairTrips(
  sources: readonly LinkTripView[],
  targets: readonly LinkTripView[]
): {
  source: LinkTripView;
  target: LinkTripView;
  reason: LinkCandidateReason;
  ambiguous: boolean;
}[] {
  const edges: Edge[] = [];
  for (const source of sources)
    for (const c of rankCandidates(source, targets))
      edges.push({ source, target: c, reason: c.reason });
  const best = (key: (e: Edge) => string) => {
    const m = new Map<string, { rank: number; count: number }>();
    for (const e of edges) {
      const k = key(e);
      const r = REASON_RANK[e.reason];
      const cur = m.get(k);
      if (!cur || r < cur.rank) m.set(k, { rank: r, count: 1 });
      else if (r === cur.rank) cur.count += 1;
    }
    return m;
  };
  const bySource = best((e) => e.source.id);
  const byTarget = best((e) => e.target.id);
  edges.sort(
    (a, b) =>
      REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
      (a.source.startDay ?? "").localeCompare(b.source.startDay ?? "") ||
      a.source.id.localeCompare(b.source.id)
  );
  const usedS = new Set<string>();
  const usedT = new Set<string>();
  const out = [];
  for (const e of edges) {
    if (usedS.has(e.source.id) || usedT.has(e.target.id)) continue;
    usedS.add(e.source.id);
    usedT.add(e.target.id);
    const r = REASON_RANK[e.reason];
    const s = bySource.get(e.source.id);
    const t = byTarget.get(e.target.id);
    const ambiguous =
      e.reason === "overlap" ||
      (s !== undefined && s.rank === r && s.count > 1) ||
      (t !== undefined && t.rank === r && t.count > 1);
    out.push({ source: e.source, target: e.target, reason: e.reason, ambiguous });
  }
  return out;
}

const TRIP_SELECT = {
  id: true,
  name: true,
  startDay: true,
  endDay: true,
  shareGroupId: true,
} as const;

/** Local: every trip of the caller that is the same as one of `otherId`'s. */
export async function localBulkPairs(userId: string, otherId: string): Promise<BulkPairs> {
  const other = await prisma.user.findFirst({
    where: { id: otherId, isActive: true },
    select: { id: true },
  });
  if (!other) throw new AppError("No such user on this server", 404, "SHARE_USER_NOT_FOUND");
  if (!(await mayOfferTripTo(prisma, userId, otherId))) return AWAITING_CONSENT;
  // A trip that came from another server is linked from its home, never from here.
  const notForeign = {
    OR: [{ shareGroupId: null }, { shareGroup: { homeOrigin: null } }],
  };
  const [mine, theirs] = await Promise.all([
    prisma.trip.findMany({ where: { userId, ...notForeign }, select: TRIP_SELECT }),
    prisma.trip.findMany({ where: { userId: otherId, ...notForeign }, select: TRIP_SELECT }),
  ]);
  const groupOf = new Map([...mine, ...theirs].map((t) => [t.id, t.shareGroupId]));
  const pairs: BulkPair[] = [];
  // Already linked first: both trips in one group.
  const linkedMine = new Set<string>();
  const linkedTheirs = new Set<string>();
  for (const m of mine) {
    if (!m.shareGroupId) continue;
    const t = theirs.find((x) => x.shareGroupId === m.shareGroupId);
    if (!t) continue;
    linkedMine.add(m.id);
    linkedTheirs.add(t.id);
    pairs.push({
      id: m.id,
      trip: tripView(m),
      other: tripView(t),
      reason: null,
      linked: true,
      ambiguous: false,
    });
  }
  // The other account's trip must be in no group, or in the caller's (`counterpart`).
  const open = (t: { id: string }) => !linkedTheirs.has(t.id);
  for (const p of pairTrips(
    mine.filter((m) => !linkedMine.has(m.id)).map(tripView),
    theirs.filter(open).map(tripView)
  )) {
    const tg = groupOf.get(p.target.id);
    if (tg && tg !== groupOf.get(p.source.id)) continue;
    pairs.push({
      id: p.source.id,
      trip: p.source,
      other: p.target,
      reason: p.reason,
      linked: false,
      ambiguous: p.ambiguous,
    });
  }
  return { access: "full", pairs: sortPairs(pairs) };
}

const sortPairs = (pairs: BulkPair[]) =>
  pairs.sort((a, b) =>
    (a.trip?.startDay ?? a.other.startDay ?? "").localeCompare(
      b.trip?.startDay ?? b.other.startDay ?? ""
    )
  );

/** Receiving across servers: each open offer (with consent) against the caller's own trips. */
export async function remoteBulkPairs(userId: string): Promise<BulkPairs> {
  await requireTripFederation(userId);
  const offers = await listOpenOffers(userId);
  const consenting = await acceptedParties(
    prisma,
    { kind: "user", id: userId },
    offers.map((o) => ({ kind: "remote" as const, id: o.remoteId }))
  );
  const open = offers.filter((o) => consenting.has(`remote:${o.remoteId}`));
  const own = await prisma.trip.findMany({
    where: { userId, shareGroupId: null },
    select: TRIP_SELECT,
  });
  const views = new Map(open.map((o) => [o.id, offeredTrip(o)]));
  const matched = pairTrips([...views.values()], own.map(tripView));
  const byOffer = new Map(matched.map((m) => [m.source.id, m]));
  const pairs: BulkPair[] = open.map((o) => {
    const m = byOffer.get(o.id);
    return {
      id: o.id,
      trip: m?.target ?? null,
      other: views.get(o.id) as LinkTripView,
      reason: m?.reason ?? null,
      linked: false,
      ambiguous: m?.ambiguous ?? false,
      from: { displayName: o.remote.displayName, origin: o.remote.origin },
    };
  });
  return { access: "full", pairs: sortPairs(pairs) };
}

/** Remote member states a trip may be offered again from (or is waiting in: `invited`). */
const REOFFERABLE = new Set(["invited", "left", "declined", "revoked"]);

export interface BulkOfferCandidate extends LinkTripView {
  /** Offered already and waiting for their answer: offering again does nothing new. */
  offered: boolean;
}

/**
 * Sending across servers: the caller's trips the person travelled on — a companion on the trip is
 * linked to them — that are not shared with them yet. The person's own trips are on their server
 * and are never read from here; their bulk link pairs the offers with them.
 */
export async function remoteBulkOfferCandidates(
  userId: string,
  remoteId: string
): Promise<BulkOfferCandidate[]> {
  await requireTripFederation(userId);
  const remote = await prisma.remoteShareAccount.findFirst({
    where: { id: remoteId, userId, state: "active" },
    select: { id: true },
  });
  if (!remote)
    throw new AppError("Connect with that person first", 409, "SHARE_REMOTE_CONNECTION_REQUIRED");
  const trips = await prisma.trip.findMany({
    where: {
      userId,
      OR: [{ shareGroupId: null }, { shareGroup: { homeOrigin: null } }],
      companionLinks: { some: { companion: { linkedRemoteId: remoteId } } },
    },
    select: {
      ...TRIP_SELECT,
      shareGroup: { select: { remoteMembers: { where: { remoteId }, select: { state: true } } } },
    },
    orderBy: { startDay: "asc" },
  });
  return trips.flatMap((t) => {
    const states = t.shareGroup?.remoteMembers.map((m) => m.state) ?? [];
    if (states.some((s) => !REOFFERABLE.has(s))) return [];
    return [{ ...tripView(t), offered: states.includes("invited") }];
  });
}

/**
 * One step of a bulk offer: only a trip the bulk list names for that person is offered (security
 * review 2026-11-27) — the bulk route must not become a way to offer any trip outside the single
 * offer's checks and budget.
 */
export async function bulkOffer(
  userId: string,
  tripId: string,
  remoteId: string
): Promise<RemoteMemberView> {
  const candidates = await remoteBulkOfferCandidates(userId, remoteId);
  if (!candidates.some((c) => c.id === tripId))
    throw new AppError(
      "That trip is not on the bulk list for this person",
      409,
      "SHARE_REMOTE_BULK_NOT_CANDIDATE",
      "tripId"
    );
  return offerTrip(userId, tripId, remoteId);
}
