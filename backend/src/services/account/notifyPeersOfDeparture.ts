import { prisma } from "../../db";
import logger from "../../utils/logger";
import { endConnection } from "../sharing/federation/connections/actions";
import { runDeliveries } from "../sharing/federation/outbox";

/** Connection states the other server still acts on; an ended one has nothing left to withdraw. */
const OPEN_STATES = ["active", "reconfirm", "pending_out", "pending_in"];

/**
 * The longest an account deletion waits for the trip-share outbox. The rows it
 * leaves undelivered go with the account (they cascade), so a peer that is down
 * learns of the departure the way it learns of any vanished pairing — its next
 * message is refused. Bounded so one dead peer cannot hold the request open.
 */
export const DEPARTURE_DELIVERY_BUDGET_MS = 10_000;

export interface DepartureNotice {
  ended: number;
  failed: number;
}

/**
 * Before an account goes: withdraw every connection it holds with a person on
 * another server through the existing path (`endConnection` — statistics,
 * leaderboard, consents and memberships end, the other server gets a
 * `connect-revoke` and every shared trip a `revoke`), then give the outbox one
 * bounded delivery pass while the rows still exist. Never throws: a peer that
 * cannot be told is logged, and the deletion the user asked for goes ahead.
 */
export async function notifyPeersOfDeparture(userId: string): Promise<DepartureNotice> {
  const connections = await prisma.remoteShareAccount.findMany({
    where: { userId, state: { in: OPEN_STATES } },
    select: { id: true, origin: true },
  });
  const notice: DepartureNotice = { ended: 0, failed: 0 };
  if (connections.length === 0) return notice;

  const work = async (): Promise<void> => {
    for (const c of connections) {
      try {
        await endConnection(userId, c.id);
        notice.ended++;
      } catch (error) {
        notice.failed++;
        logger.warn(
          {
            operation: "account_delete_peer_withdraw_failed",
            userId,
            origin: c.origin,
            error: { message: error instanceof Error ? error.message : String(error) },
          },
          "Could not withdraw a federated connection before deleting the account; it ends with the account"
        );
      }
    }
    // Only this account's streams: the rest of the queue is not its business.
    await runDeliveries(undefined, userId);
  };

  // One budget for the whole phase: each withdrawal also tries its announcement
  // once, so several dead peers in a row must not add up their timeouts.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DEPARTURE_DELIVERY_BUDGET_MS);
  });
  // Settled on its own, so a rejection after the deadline is still logged, never unhandled.
  const running = work().then(
    () => "done" as const,
    (error: unknown) => {
      logger.warn(
        {
          operation: "account_delete_peer_delivery_failed",
          userId,
          error: { message: error instanceof Error ? error.message : String(error) },
        },
        "Trip-share messages for a deleted account were not all delivered"
      );
      return "failed" as const;
    }
  );
  try {
    if ((await Promise.race([running, deadline])) === "timeout")
      logger.warn(
        { operation: "account_delete_peer_budget_exceeded", userId, ...notice },
        "Telling federated peers took longer than its budget; the deletion goes ahead"
      );
  } finally {
    if (timer) clearTimeout(timer);
  }
  return notice;
}
