/**
 * A trip shared with the caller must be noticed (2026-11-24: a trip arrived on a father's server,
 * accepted, with nobody told). This is what the dashboard banner and the dot on "Reisen" read:
 * every trip that arrived and was not looked at yet (an unread `shared` notice — taken by the
 * caller's consent or by their accept) and every offer from another server still waiting for an
 * answer. The inbox lists the same notices and offers; the badge counts them (`inboxCount`).
 */
import { prisma } from "../../db";
import { remoteActorOf } from "./notices";
import { pendingOfferSummaries } from "./federation/offerInbox";
import { PERSON_SELECT, toPerson } from "./people";

export interface ReceivedTripItem {
  kind: "shared" | "offer";
  /** The notice (`shared`) or the offer (`offer`) the item stands for. */
  id: string;
  /** The caller's own trip; null for an offer not answered yet. */
  tripId: string | null;
  tripName: string;
  from: { displayName: string; origin: string | null };
  /** Taken without a question because the caller's consent said yes beforehand. */
  autoAccepted: boolean;
  /**
   * The caller's own trip was LINKED with the sender's copy, not received as a new trip — the
   * banner says "hat eure Reise verknüpft" (sharing UAT 2).
   */
  linked?: boolean;
}

export interface ReceivedTrips {
  items: ReceivedTripItem[];
  count: number;
}

const afterOf = (after: unknown): Record<string, unknown> =>
  after && typeof after === "object" && !Array.isArray(after)
    ? (after as Record<string, unknown>)
    : {};

export async function receivedTrips(userId: string): Promise<ReceivedTrips> {
  const [notices, offers] = await Promise.all([
    prisma.shareNotice.findMany({
      where: { userId, kind: "shared", entityType: "trip", readAt: null },
      include: {
        actor: { select: PERSON_SELECT },
        remoteActor: { select: { displayName: true, origin: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    pendingOfferSummaries(userId),
  ]);
  const shared: ReceivedTripItem[] = notices.map((n) => {
    const after = afterOf(n.after);
    const remote = remoteActorOf(n.after, n.remoteActor);
    return {
      kind: "shared",
      id: n.id,
      tripId: n.entityKey,
      tripName: typeof after.tripName === "string" ? after.tripName : "",
      from: n.actor
        ? { displayName: toPerson(n.actor).displayName, origin: null }
        : remote
          ? { displayName: remote.displayName, origin: remote.origin }
          : { displayName: "", origin: null },
      autoAccepted: after.autoAccepted === true,
      linked: after.linked !== undefined && after.linked !== null,
    };
  });
  const offered: ReceivedTripItem[] = offers.map((o) => ({
    kind: "offer",
    id: o.id,
    tripId: null,
    tripName: o.trip.name,
    from: { displayName: o.from.displayName, origin: o.from.origin },
    autoAccepted: false,
  }));
  const items = [...offered, ...shared];
  return { items, count: items.length };
}

/** The banner was seen: the arrived trips count as read (offers stay until answered). */
export async function markReceivedTripsSeen(userId: string): Promise<void> {
  await prisma.shareNotice.updateMany({
    where: { userId, kind: "shared", entityType: "trip", readAt: null },
    data: { readAt: new Date() },
  });
}
