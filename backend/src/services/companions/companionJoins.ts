import { Prisma } from "../../prisma";
import type { DbTransaction } from "../../db";

const SEATED_FACTS = [
  "seat_number",
  "seat_class",
  "ticket_number",
  "booking_reference",
  "loyalty_number",
  "facts_source",
] as const;

/**
 * The join tables that link a companion to an entry, one per kind of entry a
 * companion can be on. `kind` is the domain key the UI gates on — or `trip`,
 * which is no domain and is never hidden (owner, 2026-08-23).
 *
 * Table and column names are constants of this file and never come from a
 * request, which is what makes the `Prisma.raw` below safe.
 */
export const COMPANION_JOINS = [
  { kind: "flight", table: "flight_companions", entry: "flight_id", facts: SEATED_FACTS },
  { kind: "trip", table: "trip_companions", entry: "trip_id", facts: [] },
  {
    kind: "cruise",
    table: "cruise_companions",
    entry: "cruise_id",
    facts: ["cabin", "booking_reference", "loyalty_number", "facts_source"],
  },
  { kind: "rail", table: "rail_journey_companions", entry: "rail_journey_id", facts: SEATED_FACTS },
  { kind: "bus", table: "bus_journey_companions", entry: "bus_journey_id", facts: SEATED_FACTS },
  {
    kind: "ferry",
    table: "ferry_journey_companions",
    entry: "ferry_journey_id",
    facts: SEATED_FACTS,
  },
  {
    kind: "rental",
    table: "rental_booking_companions",
    entry: "rental_booking_id",
    facts: ["is_driver", "booking_reference", "loyalty_number", "facts_source"],
  },
] as const;

/**
 * A stay's per-person facts only (document-links D7): WHO is on a stay is its
 * text list, so this table is not a join in the sense above and stays out of
 * `COMPANION_JOINS` (whose counts and kinds would count a stay twice).
 */
const STAY_FACTS_TABLE = {
  table: "lodging_stay_companions",
  entry: "lodging_stay_id",
  facts: ["booking_reference", "loyalty_number", "facts_source"],
} as const;

/** A kind of entry that links a companion through a join table. */
export type CompanionJoinKind = (typeof COMPANION_JOINS)[number]["kind"];

/**
 * Every kind of entry a companion can be on: the join tables, plus lodging
 * stays, which name their companions as text only (`companionStays.ts`). In
 * display order.
 */
export const COMPANION_USE_KINDS = [
  "flight",
  "trip",
  "cruise",
  "lodging",
  "rail",
  "bus",
  "ferry",
  "rental",
] as const;
export type CompanionUseKind = (typeof COMPANION_USE_KINDS)[number];

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
): Promise<Record<CompanionJoinKind, JoinMoveCount>> {
  const out = {} as Record<CompanionJoinKind, JoinMoveCount>;
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
  const tables: Array<{
    table: string;
    entry: string;
    facts: readonly string[];
    position: boolean;
  }> = [
    ...COMPANION_JOINS.map((j) => ({ ...j, position: true })),
    { ...STAY_FACTS_TABLE, position: false },
  ];
  for (const join of tables) {
    const table = Prisma.raw(`"${join.table}"`);
    const entry = Prisma.raw(`"${join.entry}"`);
    if (join.position) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${table} AS t SET position = LEAST(t.position, s.position)
        FROM ${table} AS s
        WHERE t.companion_id = ${target} AND s.companion_id = ${source} AND t.${entry} = s.${entry}`);
    }
    // The person's own facts survive the merge: the target's value wins, the
    // source's fills what the target never recorded (D7).
    for (const fact of join.facts) {
      const col = Prisma.raw(`"${fact}"`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${table} AS t SET ${col} = COALESCE(t.${col}, s.${col})
        FROM ${table} AS s
        WHERE t.companion_id = ${target} AND s.companion_id = ${source} AND t.${entry} = s.${entry}`);
    }
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM ${table} AS s USING ${table} AS t
      WHERE s.companion_id = ${source} AND t.companion_id = ${target} AND t.${entry} = s.${entry}`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE ${table} SET companion_id = ${target} WHERE companion_id = ${source}`);
  }
  // A document assigned to the merged-away person is now the target's (D7);
  // SetNull would otherwise have turned it back into "me".
  await tx.$executeRaw(Prisma.sql`
    UPDATE document_links SET companion_id = ${target} WHERE companion_id = ${source}`);
}
