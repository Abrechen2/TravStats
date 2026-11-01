/**
 * The shared half of the "forms suggest what you entered before" endpoints
 * (bus, ferry, rental, cruise, places): frequency-ranked distinct values of a
 * text column and the terminals of a two-ended ride. Everything is the user's
 * own rows, bounded in the database; nothing is written.
 */

export interface Ranked {
  value: string;
  count: number;
}

const byCountThenName = (a: Ranked, b: Ranked): number =>
  b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/**
 * Most frequent first, then by name in code-point order — a total order that
 * does not depend on the database's collation, so the list does not reshuffle
 * between two requests. "Kobus" and "kobus" are one value, spelled as the
 * larger group has it (and, level, as the one that sorts first).
 */
export function mergeRanked(rows: Ranked[]): Ranked[] {
  const merged = new Map<string, Ranked>();
  for (const row of [...rows].sort(byCountThenName)) {
    const key = row.value.toLowerCase();
    const seen = merged.get(key);
    merged.set(
      key,
      seen
        ? { value: seen.value, count: seen.count + row.count }
        : { value: row.value, count: row.count }
    );
  }
  return [...merged.values()].sort(byCountThenName);
}

/** Rows read per group before the case-insensitive merge (which only shrinks). */
export const OVERFETCH = 3;

/** The slice of a Prisma delegate the ranking needs; every journey-like model has it. */
export interface GroupableDelegate {
  groupBy(args: unknown): Promise<unknown>;
}

/**
 * Distinct values of one text column, grouped and bounded in the database.
 * `where` is the caller's scope (always includes the user); blanks and nulls
 * are left out.
 */
export async function rankedColumn(
  delegate: GroupableDelegate,
  field: string,
  where: object,
  cap: number,
  /** False for a required column, where `not: null` is not a valid filter. */
  nullable = true
): Promise<string[]> {
  const groups = (await delegate.groupBy({
    by: [field],
    where: {
      AND: [
        where,
        { AND: [...(nullable ? [{ [field]: { not: null } }] : []), { NOT: { [field]: "" } }] },
      ],
    },
    _count: { [field]: true },
    // The name breaks count ties so the take below cuts at a stable place.
    orderBy: [{ _count: { [field]: "desc" } }, { [field]: "asc" }],
    take: cap * OVERFETCH,
  })) as Array<{ [key: string]: unknown; _count: Record<string, number> }>;
  return mergeRanked(
    groups
      .map((g) => ({ value: String(g[field] ?? "").trim(), count: g._count[field] ?? 0 }))
      .filter((g) => g.value !== "")
  )
    .slice(0, cap)
    .map((r) => r.value);
}

/**
 * A typed name is text, not a pattern. Prisma passes `startsWith` into a LIKE
 * unescaped, so a `%` would match every value and an `_` any character.
 */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");
