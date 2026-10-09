import type { DbTransaction } from "../../db";

/**
 * Serialise every writer of one roadtrip's station list (review M1).
 *
 * Three writers change it: the editor's full-list PUT (`replaceStations`), the
 * phone's append and the phone's removal (`companionStations.ts`). Under Read
 * Committed, a phone append that committed between the PUT's read of the
 * existing stations and its delete of the dropped ones was deleted after all —
 * the `expectedStationIds` check had read the set before the append existed.
 * And the phone's removal renumbered from a list read before its transaction,
 * so a station the web had added meanwhile was left without a position.
 *
 * Each writer takes this row lock first, inside its transaction, and reads the
 * stations only after it: the second writer waits for the first to commit and
 * then sees what it wrote.
 */
export async function lockRoute(tx: DbTransaction, routeId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM trip_routes WHERE id = ${routeId} FOR UPDATE`;
}
