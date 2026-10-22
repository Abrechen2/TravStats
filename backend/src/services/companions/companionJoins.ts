import { Prisma } from "../../prisma";
import type { DbTransaction } from "../../db";

/**
 * The join tables that link a companion to an entry, one per kind of entry a
 * companion can be on. `kind` is the domain key the UI gates on — or `trip`,
 * which is no domain and is never hidden (owner, 2026-08-23).
 *
 * Table and column names are constants of this file and never come from a
 * request, which is what makes the `Prisma.raw` below safe.
 */
export const COMPANION_JOINS = [
  { kind: "flight", table: "flight_companions", entry: "flight_id" },
  { kind: "trip", table: "trip_companions", entry: "trip_id" },
  { kind: "cruise", table: "cruise_companions", entry: "cruise_id" },
  { kind: "rail", table: "rail_journey_companions", entry: "rail_journey_id" },
  { kind: "bus", table: "bus_journey_companions", entry: "bus_journey_id" },
  { kind: "ferry", table: "ferry_journey_companions", entry: "ferry_journey_id" },
  { kind: "rental", table: "rental_booking_companions", entry: "rental_booking_id" },
] as const;

export type CompanionUseKind = (typeof COMPANION_JOINS)[number]["kind"];
export const COMPANION_USE_KINDS: readonly CompanionUseKind[] = COMPANION_JOINS.map((j) => j.kind);

export interface JoinMoveCount {
  /** Entries the source is on. */
  entries: number;
  /** Of those, entries the target is on already: one link survives, not two. */
  shared: number;
}

/** What a merge of `source` into `target` would move, per kind of entry. */
export async function countJoinMoves(
  tx: DbTransaction,
  source: string,
  target: string
): Promise<Record<CompanionUseKind, JoinMoveCount>> {
  const out = {} as Record<CompanionUseKind, JoinMoveCount>;
  for (const join of COMPANION_JOINS) {
    const table = Prisma.raw(`"${join.table}"`);
    const entry = Prisma.raw(`"${join.entry}"`);
    const [row] = await tx.$queryRaw<{ entries: bigint; shared: bigint }[]>(Prisma.sql`
      SELECT count(*) AS entries,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM ${table} t WHERE t.companion_id = ${target} AND t.${entry} = s.${entry}
             )) AS shared
      FROM ${table} s WHERE s.companion_id = ${source}`);
    out[join.kind] = { entries: Number(row?.entries ?? 0), shared: Number(row?.shared ?? 0) };
  }
  return out;
}

/**
 * Moves every link of `source` onto `target`. Where both are on the same entry
 * the target's link stays, at the LOWER of the two positions, and the source's
 * goes — the entry keeps one person, in the place they were listed first.
 */
export async function moveJoins(tx: DbTransaction, source: string, target: string): Promise<void> {
  for (const join of COMPANION_JOINS) {
    const table = Prisma.raw(`"${join.table}"`);
    const entry = Prisma.raw(`"${join.entry}"`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE ${table} AS t SET position = LEAST(t.position, s.position)
      FROM ${table} AS s
      WHERE t.companion_id = ${target} AND s.companion_id = ${source} AND t.${entry} = s.${entry}`);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM ${table} AS s USING ${table} AS t
      WHERE s.companion_id = ${source} AND t.companion_id = ${target} AND t.${entry} = s.${entry}`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE ${table} SET companion_id = ${target} WHERE companion_id = ${source}`);
  }
}
