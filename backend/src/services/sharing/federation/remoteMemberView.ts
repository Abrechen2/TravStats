/**
 * How a person on another server appears on a trip page (spec 2026-10-20 §7: "every remote
 * member row in the trip's people section carries its state"): name, server, state, what last
 * went wrong, and — since F-S4d — where the changes made here stand on their way there, so the
 * page says it instead of showing a member who silently has nothing.
 */
import { prisma } from "../../../db";
import { remoteMemberStateSchema, type RemoteMemberState } from "../../../schemas/sharingRemote";

/**
 * The outbox towards one member, as one state (F-S4d):
 * - `delivered` — nothing waits;
 * - `pending` — messages wait for the next delivery pass;
 * - `retrying` — their server has not answered since `stateSince` (`reason`: the failure kind);
 * - `unreachable` — not since `stateSince`, for 14 days or more;
 * - `rejected` — refused for good, or too large to send (`reason`: `schema`, `not-member`,
 *   `consent`, `too-large`; `field` what did not parse; `label` the entry it was about); it is kept, not sent.
 */
export interface DeliveryView {
  state: "delivered" | "pending" | "retrying" | "unreachable" | "rejected";
  /** Since when the delivery is in this state: failing since, or when it was refused. */
  stateSince: string | null;
  reason: string | null;
  field: string | null;
  label: string | null;
}

export interface RemoteMemberView {
  id: string;
  remoteId: string;
  displayName: string;
  username: string;
  origin: string;
  state: RemoteMemberState;
  /** `restore`, `off`, `peer-blocked`, `entries-too-large`, … — null when nothing is wrong. */
  stateReason: string | null;
  stateSince: string;
  delivery: DeliveryView;
}

export const MEMBER_INCLUDE = {
  remote: { select: { id: true, displayName: true, username: true, origin: true } },
} as const;

interface MemberRow {
  id: string;
  groupId: string;
  state: string;
  stateReason: string | null;
  stateSince: Date;
  remote: { id: string; displayName: string; username: string; origin: string };
}

const DELIVERED: DeliveryView = {
  state: "delivered",
  stateSince: null,
  reason: null,
  field: null,
  label: null,
};

/** The delivery state of each member, read from the outbox in two queries. */
async function deliveryOf(rows: readonly MemberRow[]): Promise<Map<string, DeliveryView>> {
  const out = new Map<string, DeliveryView>();
  if (rows.length === 0) return out;
  const queued = await prisma.tripShareOutbox.findMany({
    where: { OR: rows.map((r) => ({ groupId: r.groupId, peerOrigin: r.remote.origin })) },
    orderBy: { position: "asc" },
    select: {
      memberId: true,
      groupId: true,
      peerOrigin: true,
      failingSince: true,
      lastError: true,
      parkedAt: true,
      parkedReason: true,
      label: true,
    },
  });
  for (const m of rows) {
    const stream = queued.filter(
      (q) => q.groupId === m.groupId && q.peerOrigin === m.remote.origin
    );
    const waiting = stream.filter((q) => !q.parkedAt);
    // The stream's first waiting message holds every later one: its failure is theirs too.
    const head = waiting[0];
    const mine = waiting.filter((q) => q.memberId === m.id);
    const parked = stream.filter((q) => q.parkedAt && q.memberId === m.id).at(-1);
    const failing = head?.failingSince ?? null;
    if (m.state === "unreachable")
      out.set(m.id, {
        ...DELIVERED,
        state: "unreachable",
        stateSince: (failing ?? m.stateSince).toISOString(),
      });
    else if (mine.length > 0 && failing)
      out.set(m.id, {
        ...DELIVERED,
        state: "retrying",
        stateSince: failing.toISOString(),
        reason: head?.lastError ?? null,
      });
    else if (parked)
      out.set(m.id, {
        state: "rejected",
        stateSince: parked.parkedAt?.toISOString() ?? null,
        reason: parked.parkedReason,
        field: parked.parkedReason === "schema" ? parked.lastError : null,
        label: parked.label,
      });
    else out.set(m.id, mine.length > 0 ? { ...DELIVERED, state: "pending" } : DELIVERED);
  }
  return out;
}

export async function remoteMemberViews(rows: readonly MemberRow[]): Promise<RemoteMemberView[]> {
  const delivery = await deliveryOf(rows);
  return rows.map((row) => ({
    id: row.id,
    remoteId: row.remote.id,
    displayName: row.remote.displayName,
    username: row.remote.username,
    origin: row.remote.origin,
    state: remoteMemberStateSchema.parse(row.state),
    stateReason: row.stateReason,
    stateSince: row.stateSince.toISOString(),
    delivery: delivery.get(row.id) ?? DELIVERED,
  }));
}

export async function readRemoteMember(id: string): Promise<RemoteMemberView> {
  const row = await prisma.tripShareRemoteMember.findUniqueOrThrow({
    where: { id },
    include: MEMBER_INCLUDE,
  });
  const [view] = await remoteMemberViews([row]);
  return view;
}
