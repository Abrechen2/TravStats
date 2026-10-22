import type { DbTransaction } from "../../db";
import { rewriteCompanionNames } from "./nameRewrite";

/**
 * Every table that stores companions as a denormalised NAME array beside (or,
 * for stays, instead of) the join rows. The array is what lists, exports and
 * the phone's sync feed read (`services/sync/entities.ts`: an entry carries its
 * companions as its own `companions` array), so a rename or merge that moved
 * only the join rows would leave every list naming the old spelling.
 *
 * Lodging stays have no join table: their array is plain text and is matched
 * by the canonical name alone.
 */
export const COMPANION_ARRAY_TABLES = [
  "flight",
  "trip",
  "cruise",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
] as const;
export type CompanionArrayTable = (typeof COMPANION_ARRAY_TABLES)[number];

type Row = { id: string; companions: string[] };
const ROW = { id: true, companions: true } as const;

/** The caller's rows of one table that name anybody at all. */
function rowsOf(tx: DbTransaction, table: CompanionArrayTable, userId: string): Promise<Row[]> {
  const where = { userId, NOT: { companions: { isEmpty: true } } };
  switch (table) {
    case "flight":
      return tx.flight.findMany({ where, select: ROW });
    case "trip":
      return tx.trip.findMany({ where, select: ROW });
    case "cruise":
      return tx.cruise.findMany({ where, select: ROW });
    case "lodgingStay":
      return tx.lodgingStay.findMany({ where, select: ROW });
    case "railJourney":
      return tx.railJourney.findMany({ where, select: ROW });
    case "busJourney":
      return tx.busJourney.findMany({ where, select: ROW });
    case "ferryJourney":
      return tx.ferryJourney.findMany({ where, select: ROW });
    case "rentalBooking":
      return tx.rentalBooking.findMany({ where, select: ROW });
  }
}

/**
 * One row's new array. `@updatedAt` moves with it, and the table's sync
 * trigger records the change — that is how the phone learns of the new name.
 * Companions are private on every shareable type (`sharing/facts/*.ts`), so no
 * other account's copy has anything to receive.
 */
async function writeRow(
  tx: DbTransaction,
  table: CompanionArrayTable,
  id: string,
  companions: string[]
): Promise<void> {
  const data = { companions };
  switch (table) {
    case "flight":
      // share-exempt: companions are private on a shared flight (facts/flight.ts)
      await tx.flight.update({ where: { id }, data });
      return;
    case "trip":
      await tx.trip.update({ where: { id }, data });
      return;
    case "cruise":
      // share-exempt: companions are private on a shared cruise (facts/cruise.ts)
      await tx.cruise.update({ where: { id }, data });
      return;
    case "lodgingStay":
      // share-exempt: companions are private on a shared stay (facts/lodgingStay.ts)
      await tx.lodgingStay.update({ where: { id }, data });
      return;
    case "railJourney":
      // share-exempt: companions are private on a shared ride (facts/rail.ts)
      await tx.railJourney.update({ where: { id }, data });
      return;
    case "busJourney":
      // share-exempt: companions are private on a shared ride (facts/bus.ts)
      await tx.busJourney.update({ where: { id }, data });
      return;
    case "ferryJourney":
      // share-exempt: companions are private on a shared crossing (facts/ferry.ts)
      await tx.ferryJourney.update({ where: { id }, data });
      return;
    case "rentalBooking":
      // share-exempt: companions are private on a shared rental (facts/rental.ts)
      await tx.rentalBooking.update({ where: { id }, data });
      return;
  }
}

export type ArrayRewriteCounts = Record<CompanionArrayTable, number>;

/**
 * Rewrites every name array of the caller's that names one of `from`
 * (canonical forms) to `to`, and reports how many rows changed per table.
 * Only rows that change are written. Scoped to `userId`: another account's
 * entries — a shared copy included — keep their own companions.
 */
export async function rewriteCompanionArrays(
  tx: DbTransaction,
  userId: string,
  from: ReadonlySet<string>,
  to: string,
  dryRun = false
): Promise<ArrayRewriteCounts> {
  const counts = Object.fromEntries(
    COMPANION_ARRAY_TABLES.map((t) => [t, 0])
  ) as ArrayRewriteCounts;
  for (const table of COMPANION_ARRAY_TABLES) {
    for (const row of await rowsOf(tx, table, userId)) {
      const next = rewriteCompanionNames(row.companions, from, to);
      if (!next) continue;
      counts[table] += 1;
      if (!dryRun) await writeRow(tx, table, row.id, next);
    }
  }
  return counts;
}
