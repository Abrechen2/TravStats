/**
 * Messages about something already done on this side that the other server must still learn: a
 * connection ended, declined or changed, a plan declined or left (spec 2026-11-02, S1's open
 * point). What this side gives stops here at once; the announcement is the courtesy that makes
 * the other side stop too, so it is kept and retried instead of tried once and forgotten.
 *
 * A row is a message on disk. Its id is the message id on every attempt. A pass sends what is due,
 * deletes what was acknowledged, and delays what failed by the outbox's own backoff (1 min, 5 min,
 * 30 min, 2 h, 12 h, then daily). Every receiver treats these as idempotent - a connection
 * message by its generation, a plan message by the member's state - so a repeat changes nothing.
 * After 14 days of failing the row is dropped: the other side refuses on its own and learns from
 * the next message it does get. A dropped `connect-settings` is the one loss that stays silent
 * (the two sides disagree on what is shared), so its connection goes back to `reconfirm`.
 */
import { prisma, type DbTransaction } from "../../../../db";
import type { Prisma } from "../../../../prisma";
import logger from "../../../../utils/logger";
import { connectReplySchema, type TripSharePacket } from "../../../../schemas/tripSharePeer";
import { planReplySchema } from "../../../../schemas/tripSharePlans";
import { tripFederationAvailability } from "../availability";
import { UNREACHABLE_AFTER_MS, backoffAfter } from "../outbox";
import { LOCAL_ERROR, kindOf } from "../peerCheck";
import { messageHeader, tripShareExchange } from "../transport";
import { holdConnectionsById } from "./hooks";

export const ANNOUNCEMENT_KINDS = [
  "connect-decline",
  "connect-revoke",
  "connect-settings",
  "plan-decline",
  "plan-leave",
] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];
type Payload = Record<string, unknown>;

const BATCH = 50;

/** The wire message of a row: its payload under a fresh header whose id is the row's. */
const messageOf = (row: { id: string; kind: string; payload: unknown }): TripSharePacket =>
  ({
    kind: row.kind,
    ...(row.payload as Payload),
    ...messageHeader(),
    messageId: row.id,
  }) as TripSharePacket;

/** Did the other server take it? A connection message answers `received`, a plan one `ok`. */
function acknowledged(kind: string, reply: unknown): boolean {
  if (kind.startsWith("connect-")) return connectReplySchema.safeParse(reply).success;
  const parsed = planReplySchema.safeParse(reply);
  // `notShared` is an answer too: the other side no longer holds anything to end.
  return parsed.success && (parsed.data.status === "ok" || parsed.data.status === "notShared");
}

async function attempt(row: Prisma.ConnectionAnnouncementGetPayload<object>): Promise<boolean> {
  try {
    const reply = await tripShareExchange(row.peerOrigin, messageOf(row));
    if (!acknowledged(row.kind, reply)) throw new Error("unexpected-reply");
    await prisma.connectionAnnouncement.deleteMany({ where: { id: row.id } });
    return true;
  } catch (error) {
    const kind =
      error instanceof Error && error.message === "unexpected-reply" ? "malformed" : kindOf(error);
    if (kind === LOCAL_ERROR)
      logger.warn(
        { operation: "connection_announce_local_error", kind: row.kind, err: error },
        "A connection announcement failed on this server; it is retried"
      );
    const attempts = row.attempts + 1;
    await prisma.connectionAnnouncement.updateMany({
      where: { id: row.id },
      data: {
        attempts,
        lastError: kind,
        nextAttemptAt: new Date(Date.now() + backoffAfter(attempts)),
      },
    });
    return false;
  }
}

/**
 * Write an announcement as part of the transaction of the change it announces (so the two stand or
 * fall together). A newer settings message supersedes an older queued one for the same
 * connection - only the last generation matters. Returns the row's id for `deliverAnnouncement`.
 */
export async function enqueueAnnouncement(
  tx: Pick<DbTransaction, "connectionAnnouncement">,
  connection: { id: string; origin: string },
  kind: AnnouncementKind,
  payload: Payload
): Promise<string> {
  if (kind === "connect-settings")
    await tx.connectionAnnouncement.deleteMany({ where: { connectionId: connection.id, kind } });
  const row = await tx.connectionAnnouncement.create({
    data: {
      connectionId: connection.id,
      peerOrigin: connection.origin,
      kind,
      payload: payload as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

/** After the transaction committed: try the row once at once; a miss stays queued for the scheduler. */
export async function deliverAnnouncement(id: string): Promise<void> {
  const row = await prisma.connectionAnnouncement.findUnique({ where: { id } });
  if (!row) return;
  if (!(await attempt(row)))
    logger.warn(
      { operation: "connection_announce_failed", kind: row.kind, origin: row.peerOrigin },
      "The other server did not get a connection message; it is kept and retried"
    );
}

/** `enqueueAnnouncement` and `deliverAnnouncement` for a change that has no transaction of its own. */
export async function announce(
  connection: { id: string; origin: string },
  kind: AnnouncementKind,
  payload: Payload
): Promise<void> {
  await deliverAnnouncement(await enqueueAnnouncement(prisma, connection, kind, payload));
}

export interface AnnouncementRun {
  sent: number;
  failed: number;
  dropped: number;
}

/** One delivery pass (run by the trip-share delivery scheduler). */
export async function runAnnouncements(now = new Date()): Promise<AnnouncementRun> {
  const run: AnnouncementRun = { sent: 0, failed: 0, dropped: 0 };
  if (!(await tripFederationAvailability()).available) return run;
  const cutoff = { createdAt: { lt: new Date(now.getTime() - UNREACHABLE_AFTER_MS) } };
  const stale = await prisma.connectionAnnouncement.findMany({
    where: cutoff,
    select: { id: true, kind: true, connectionId: true },
  });
  if (stale.length > 0) {
    // A revoke or decline already happened here and the other side refuses on its own; a switch
    // it never heard of leaves the two sides disagreeing silently, so that connection is held
    // for a new confirmation instead. The hold comes BEFORE the delete (a crash in between
    // repeats the pass, the hold is idempotent) and re-reads the rows: one superseded or
    // delivered meanwhile no longer counts.
    const settings = stale.filter((r) => r.kind === "connect-settings").map((r) => r.id);
    const unheard = [
      ...new Set(
        (
          await prisma.connectionAnnouncement.findMany({
            where: { id: { in: settings } },
            select: { connectionId: true },
          })
        ).map((r) => r.connectionId)
      ),
    ];
    await holdConnectionsById(unheard);
    const gone = await prisma.connectionAnnouncement.deleteMany({
      where: { id: { in: stale.map((r) => r.id) } },
    });
    run.dropped = gone.count;
    logger.warn(
      { operation: "connection_announce_dropped", count: gone.count, reconfirm: unheard.length },
      "Connection messages the other server never took were dropped after 14 days; connections with an unheard switch change are back to reconfirm"
    );
  }
  const due = await prisma.connectionAnnouncement.findMany({
    where: { nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  for (const row of due) {
    if (await attempt(row)) run.sent += 1;
    else run.failed += 1;
  }
  return run;
}
