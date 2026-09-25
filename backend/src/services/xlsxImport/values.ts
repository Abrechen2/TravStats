/**
 * Two questions every domain handler asks of a row, answered once.
 *
 *  - **Is this cell one of the field's values?** An enum cell holding text the
 *    field does not know (an old free-text cabin type, a typo in a board type)
 *    is left EMPTY and reported, and the row goes on. Refusing the row instead
 *    cost the demo data every one of its cruises over a cabin label. Abstention
 *    is the rule here as everywhere: an unknown value becomes absent, never the
 *    commonest value.
 *  - **Did anything actually change?** A re-imported row identical to what is
 *    stored is "unchanged": nothing is written, `updatedAt` stays where it
 *    was. The comparison runs on the values the write would send, so a cell the
 *    importer normalises (a trimmed name, a day turned into a Date) compares in
 *    that form.
 */

import * as cell from "./cells";
import type { DroppedValue, RowOutcome } from "./types";

/**
 * The enum value a cell names, or undefined (blank, or unknown and recorded in
 * `dropped`). Matching is case-insensitive; `synonyms` maps prose onto a value
 * where the mapping is unambiguous.
 */
export function enumCell<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  field: string,
  dropped: DroppedValue[],
  synonyms?: (value: string) => T | undefined
): T | undefined {
  const value = cell.text(raw);
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const hit = allowed.find((a) => a === lower) ?? synonyms?.(value);
  if (hit) return hit;
  dropped.push({ field, value });
  return undefined;
}

/**
 * Mark every dropped cell of a row that resolved to an existing entry as
 * `kept`. Every update path writes through `definedOnly`, so an unknown enum
 * cell (undefined) never reaches the UPDATE and the stored value survives —
 * only a create leaves the field empty. Done once over a sheet's outcomes so
 * no handler can forget it.
 */
export function markKeptDrops(rows: RowOutcome[]): RowOutcome[] {
  return rows.map((r) =>
    r.dropped && (r.action === "update" || r.action === "skip")
      ? { ...r, dropped: r.dropped.map((d) => ({ ...d, kept: true as const })) }
      : r
  );
}

/** `dropped` for a row outcome — absent rather than an empty list. */
export function droppedOrNone(dropped: DroppedValue[]): DroppedValue[] | undefined {
  return dropped.length > 0 ? dropped : undefined;
}

/** A value in the one form both sides are compared in. */
function comparable(value: unknown, other: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();
  // A day or timestamp the write path would hand Prisma as a string.
  if (typeof value === "string" && other instanceof Date) {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? value : t;
  }
  return value;
}

function same(incoming: unknown, stored: unknown): boolean {
  if (Array.isArray(incoming) || Array.isArray(stored)) {
    const a = Array.isArray(incoming) ? incoming : [];
    const b = Array.isArray(stored) ? stored : [];
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  return comparable(incoming, stored) === comparable(stored, incoming);
}

/**
 * Only the keys of `incoming` whose value differs from `stored`. An empty
 * result is the answer "this row changes nothing".
 */
export function changedOnly<T extends Record<string, unknown>>(
  incoming: T,
  stored: Record<string, unknown>
): Partial<T> {
  return Object.fromEntries(
    Object.entries(incoming).filter(([key, value]) => !same(value, stored[key]))
  ) as Partial<T>;
}

const DAY = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The instant a date cell should write, given the one already stored.
 *
 * A cell that names no time of day ("2025-07-10", "10.07.2025") on the SAME
 * UTC day as the stored value keeps the stored clock: it states the day, and
 * the day has not changed. Without this a hand-edited sheet that typed the
 * visit date back in moved a 12:00 visit to midnight, which is the same loss
 * SRV-EXPORT-001 found for the untouched export (beta audit 2026-09-20). A
 * different day, or a cell that does carry a clock, is written as read.
 */
export function keepStoredClock(
  incoming: Date | undefined,
  raw: string | undefined,
  stored: Date | null
): Date | undefined {
  if (!incoming || !stored || cell.hasClock(raw)) return incoming;
  return DAY(incoming) === DAY(stored) ? stored : incoming;
}
