/**
 * State one import run carries across its sheets, and the small helpers every
 * domain handler shares.
 *
 * WHY A RUN HAS STATE (owner, 2026-09-25): the workbook is for editing AND for
 * moving entries — also into another account. A file exported from account A
 * and read into account B carries A's ids: in column A of every row, and in
 * the brackets of every reference cell ("Hotel Okura [a1b2…]"). None of them
 * may ever touch A's rows, so to B they are simply absent — but they are still
 * the only thing that says WHICH hotel a stay row belongs to. The registry
 * below remembers, per parent sheet, "the row the file called X became Y in
 * this account", so a child row pointing at [X] lands under Y.
 *
 * `claimed` makes a second read of the same file converge instead of
 * duplicating: a row without a usable id is matched to an existing record by
 * its natural key, and every record a run touches is claimed so two identical
 * rows in one file still map to two records.
 */

import type { ImportMode, RowOutcome } from "./types";

export type ParentKind = "cruise" | "lodging" | "place";

export interface Ctx {
  userId: string;
  dryRun: boolean;
  mode: ImportMode;
  /** file id (column A or a reference's brackets) → id in this account. */
  byFileId: Record<ParentKind, Map<string, string>>;
  /** normalised label → ids registered by THIS run (incl. dry-run placeholders). */
  byLabel: Record<ParentKind, Map<string, Set<string>>>;
  /** Records this run already created, updated or matched. */
  claimed: Set<string>;
  /** Cruises whose stops changed — their legs are recomputed at the end. */
  touchedCruises: Set<string>;
  /** Anything was written — achievements are re-checked once at the end. */
  wrote: boolean;
}

export function newCtx(opts: { userId: string; dryRun: boolean; mode: ImportMode }): Ctx {
  return {
    ...opts,
    byFileId: { cruise: new Map(), lodging: new Map(), place: new Map() },
    byLabel: { cruise: new Map(), lodging: new Map(), place: new Map() },
    claimed: new Set(),
    touchedCruises: new Set(),
    wrote: false,
  };
}

/** Prefix of the stand-in id a dry run gives a record it would create. */
export const PENDING_PREFIX = "pending:";

export function pendingId(sheet: string, row: number): string {
  return `${PENDING_PREFIX}${sheet}:${row}`;
}

export function isPending(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/** Case- and whitespace-insensitive form used for every label comparison. */
export function norm(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The label a parent row is referred to by in its child sheet.
 *
 * MUST agree with `frontend/src/lib/xlsx/exportAll.ts` (`parentLabel`): the
 * export writes "Base (qualifier)" — a hotel's city, a cruise's start day — so
 * two "Ibis Budget" or two "Westliches Mittelmeer" stay apart. Files written
 * before the qualifier existed carry the base alone, which is why both forms
 * are returned.
 */
export function labelForms(base: string | null | undefined, qualifier?: string | null): string[] {
  const b = norm(base);
  if (!b) return [];
  const q = norm(qualifier);
  return q ? [`${b} (${q})`, b] : [b];
}

/** Record where a parent row ended up, so its child rows can find it. */
export function registerParent(
  ctx: Ctx,
  kind: ParentKind,
  entry: { fileId?: string; id: string; labels: string[] }
): void {
  if (entry.fileId) ctx.byFileId[kind].set(entry.fileId, entry.id);
  for (const label of entry.labels) {
    const set = ctx.byLabel[kind].get(label) ?? new Set<string>();
    set.add(entry.id);
    ctx.byLabel[kind].set(label, set);
  }
}

export function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

/**
 * Mark an id as accounted for even though its row failed.
 *
 * Caught by a test: without this, a mistyped latitude in `replace` mode does
 * not merely skip the row — it DELETES the record the row named, because the
 * id never reached `seen`. A refused row means "this line is unreadable", it
 * has never meant "destroy what it points at".
 */
export function keepDespiteError(seen: Set<string>, id: string | undefined): void {
  if (id) seen.add(id);
}

/** Only the keys the sheet actually carried — an untouched column must not
 *  become a null that erases a stored value. */
export function definedOnly<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/** `YYYY-MM-DD` of a stored date, for natural-key comparisons. */
export function dayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * A Prisma filter for "on this calendar day (UTC)", or for "undated" when the
 * row has no date. Stored values may carry a time; the sheet carries the day.
 */
export function dayRange(day: string | null | undefined): { gte: Date; lt: Date } | null {
  if (!day) return null;
  const start = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + DAY_MS) };
}

const DAY_MS = 86_400_000;

/**
 * How a row found its target when it carried no usable id of this account:
 * matched by its natural key rather than created. Reported on the row so the
 * preview says "update (matched)" instead of a bare "update".
 */
export const MATCHED = "matched_existing";
