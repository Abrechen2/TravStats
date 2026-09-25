/**
 * What the four route-shaped sheets (roadtrips, their stations, tours, tour
 * points) share, beside the rules every sheet shares in `context.ts`.
 *
 * Stations and points are the one kind of child row that cannot be applied
 * row by row: each is a position in an ORDERED list whose legs are keyed by
 * neighbouring entries, so a list is written once per parent through the
 * editor's own writer (`replaceStations`, `replaceTourPoints`). The helpers
 * below turn a sheet's rows into that list — and decide whether the list
 * changed at all, because a re-imported untouched export must write nothing
 * (owner, 2026-09-25), and rewriting a list rewrites every entry in it.
 */

import { prisma } from "../../db";
import logger from "../../utils/logger";
import type { Ctx } from "./context";
import type { RowOutcome } from "./types";

/** One list entry read from the sheet, or an existing one the file left out. */
export interface Listed<T extends { id?: string }> {
  /** Sheet row; 0 for an entry the file did not mention. */
  rowNo: number;
  label: string;
  order: number;
  item: T;
  /** The id column as the file had it — another account's, for a moved file. */
  fileId?: string;
  /** Cells whose value the field does not know. */
  dropped?: RowOutcome["dropped"];
}

/**
 * Claim-once matching of id-less rows to stored entries by a natural key.
 * Each stored entry is handed out once, so two identical rows in one file map
 * to two entries instead of both landing on the first.
 */
export function claimMatcher<S extends { id: string }>(
  stored: readonly S[],
  keyOf: (s: S) => string
): (key: string) => string | undefined {
  const free = new Map<string, string[]>();
  for (const s of stored) {
    const k = keyOf(s);
    free.set(k, [...(free.get(k) ?? []), s.id]);
  }
  return (key) => free.get(key)?.shift();
}

/** A coordinate at ~100 m — close enough that one name there is one place. */
export const coordKey = (v: number | null | undefined): string => v?.toFixed(3) ?? "";

/**
 * The full list the writer receives: the rows the file applies, plus every
 * stored entry it did not mention at its current position (1..n) — unless
 * the mode is `replace`, where leaving one out removes it. The order column
 * is the authority; decimals insert between, the sheet row breaks ties.
 */
export function mergeList<T extends { id?: string }>(
  stored: readonly { id: string }[],
  parsed: readonly Listed<T>[],
  mode: Ctx["mode"],
  toItem: (index: number) => T
): { list: Listed<T>[]; removed: number } {
  const mentioned = new Set(parsed.flatMap((p) => (p.item.id ? [p.item.id] : [])));
  const kept = stored.flatMap((s, i): Listed<T>[] =>
    mentioned.has(s.id) || mode === "replace"
      ? []
      : [{ rowNo: 0, label: "", order: i + 1, item: toItem(i) }]
  );
  const removed = mode === "replace" ? stored.filter((s) => !mentioned.has(s.id)).length : 0;
  const list = [...kept, ...parsed].sort((a, b) => a.order - b.order || a.rowNo - b.rowNo);
  return { list, removed };
}

/**
 * Per applied row: `create`, `update`, or `skip` for a row that changes
 * nothing — same values, and the same place among the entries that already
 * existed (a new entry inserted before it is not a change to it). `write` is
 * false when the whole list comes out as it is stored, so the caller leaves
 * it alone instead of rewriting every entry.
 */
export function listOutcome<T extends { id?: string }>(
  storedIds: readonly string[],
  list: readonly Listed<T>[],
  removed: number,
  same: (item: T) => boolean
): { rows: RowOutcome[]; write: boolean } {
  const survivors = storedIds.filter((id) => list.some((l) => l.item.id === id));
  const finalOrder = list.flatMap((l) => (l.item.id ? [l.item.id] : []));
  const moved = (id: string): boolean => survivors.indexOf(id) !== finalOrder.indexOf(id);
  const rows = list
    .filter((l) => l.rowNo > 0)
    .map((l): RowOutcome => {
      const id = l.item.id ?? null;
      const action = !id ? "create" : same(l.item) && !moved(id) ? "skip" : "update";
      return {
        row: l.rowNo,
        action,
        id,
        label: l.label,
        ...(l.dropped && l.dropped.length > 0 ? { dropped: l.dropped } : {}),
      };
    });
  const write = removed > 0 || rows.some((r) => r.action !== "skip");
  return { rows, write };
}

/**
 * `replace` removes the roadtrips or tours the file left out, the way their
 * delete handlers remove one: stops borrowed from a trip's timeline go back
 * to it (without their night columns), the route's own entries go with it.
 */
export async function pruneRoutes(
  kind: "roadtrip" | "tour",
  seen: Set<string>,
  ctx: Ctx
): Promise<number> {
  if (ctx.mode !== "replace") return 0;
  const where = { userId: ctx.userId, kind, id: { notIn: [...seen] } };
  const doomed = await prisma.tripRoute.findMany({ where, select: { id: true } });
  if (doomed.length === 0 || ctx.dryRun) return doomed.length;

  const ids = doomed.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    await tx.tripStop.updateMany({
      where: { routeId: { in: ids }, tripId: { not: null } },
      data: { routeId: null, routeOrderIdx: null, lodgingStayId: null, overnight: false },
    });
    await tx.tripRoute.deleteMany({ where: { id: { in: ids } } });
  });
  ctx.wrote = true;
  logger.warn(
    {
      operation: "xlsx_import_replace_deleted",
      model: kind,
      userId: ctx.userId,
      deleted: ids.length,
    },
    "Spreadsheet import in replace mode deleted rows absent from the file"
  );
  return ids.length;
}
