import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { DbTransaction } from "../../db";
import { propagateDelete, shareSnapshot } from "../sharing/propagate";
import type { ShareEntity } from "../sharing/shareTypes";
import { restatusTrips } from "../trip/restatusTrips";

/**
 * Deleting one transport entry (rail, bus, ferry, rental) — the skeleton the
 * four routers each spelled out (forgejo#382): find the caller's row (404
 * otherwise), snapshot it for the share copies, remove it, tell the other
 * members, then re-derive the status of the trip it belonged to.
 *
 * The domain supplies the lookup, its own 404, and the removal itself; this
 * file never writes a shareable table, it only propagates the removal.
 */
export interface TransportDeleteSpec {
  shareType: ShareEntity;
  /** The caller's row, or null — rows of other accounts are not found. */
  find: (id: string, userId: string) => Promise<{ id: string; tripId: string | null } | null>;
  /** The domain's own 404 (message and code differ per domain). */
  notFound: () => AppError;
  /**
   * Removes the row inside the transaction. Returns false when a version
   * claim found nothing to remove (see `onMissed`).
   */
  remove: (tx: DbTransaction, id: string) => Promise<boolean>;
}

/** `removed`: gone, 204. `missed`: the claim moved nothing; the caller answers. */
export type TransportDeleteOutcome = { kind: "removed" } | { kind: "missed"; id: string };

export async function deleteTransportEntry(
  spec: TransportDeleteSpec,
  id: string,
  userId: string,
  options: { timeout?: number } = {}
): Promise<TransportDeleteOutcome> {
  const existing = await spec.find(id, userId);
  if (!existing) throw spec.notFound();
  const removed = await prisma.$transaction(
    async (tx) => {
      const gone = await shareSnapshot(tx, spec.shareType, existing.id);
      if (!(await spec.remove(tx, existing.id))) return false;
      // The others keep their copies and are told.
      await propagateDelete(tx, userId, gone);
      return true;
    },
    options.timeout === undefined ? undefined : { timeout: options.timeout }
  );
  if (!removed) return { kind: "missed", id: existing.id };
  await restatusTrips([existing.tripId]);
  return { kind: "removed" };
}
