/**
 * The points of day tours from a spreadsheet (2.7).
 *
 * Points are an ordered list with legs keyed by neighbouring points, so they
 * go through `replaceTourPoints` — the writer the tour editor uses — once per
 * tour (see `routeLists.ts`). The order column is authoritative, decimals
 * insert between, a point the file does not mention keeps its place unless
 * the mode is `replace`, one unreadable row holds its tour back, and a list
 * that comes out as it is stored is not written at all.
 *
 * A tour that belongs to a trip draws its points from the trip's timeline,
 * which is edited at the trip — so the point rows of such a tour in THIS
 * account are skipped, never written.
 */

import { prisma } from "../../db";
import { tourPointsSchema } from "../../schemas/tour";
import { replaceTourPoints, type TourPoint } from "../tour/replaceTourPoints";
import logger from "../../utils/logger";
import * as cell from "./cells";
import { type Ctx, errorRow, isPending, norm } from "./context";
import { resolveParent } from "./references";
import { claimMatcher, coordKey, listOutcome, mergeList, type Listed } from "./routeLists";
import {
  sheetRowNumber,
  summarise,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";

type StoredPoint = {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  notes: string | null;
};

type PointParse = { ok: Listed<TourPoint> } | { error: RowOutcome } | { skip: RowOutcome };

function parsePointRow(
  raw: Record<string, string>,
  rowNo: number,
  fallbackOrder: number,
  knownIds: ReadonlySet<string>,
  ctx: Ctx
): PointParse {
  const title = cell.text(raw.title);
  const label = title ?? `#${rowNo}`;
  // An id this tour does not hold — another account's, or a typo — is a new
  // point, not a refused one: that is what a moved file carries.
  const rawId = cell.text(raw.id);
  const id = rawId && knownIds.has(rawId) ? rawId : undefined;
  if (id && ctx.mode === "add") {
    return { skip: { row: rowNo, action: "skip", id, label, message: "exists" } };
  }

  const lat = cell.num(raw.lat);
  const lon = cell.num(raw.lon);
  const order = cell.num(raw.order);
  if (
    lat === undefined ||
    lon === undefined ||
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    (order !== undefined && Number.isNaN(order))
  ) {
    return { error: errorRow(rowNo, label, "tour_point_needs_point") };
  }
  if (!title) return { error: errorRow(rowNo, label, "tour_point_needs_title") };
  return {
    ok: {
      rowNo,
      label,
      order: order ?? fallbackOrder,
      fileId: rawId,
      item: { ...(id ? { id } : {}), title, lat, lon, notes: cell.text(raw.notes) ?? null },
    },
  };
}

const pointKey = (title: string, lat: number | null, lon: number | null): string =>
  [norm(title), coordKey(lat), coordKey(lon)].join("|");

type Group = Array<{ raw: Record<string, string>; rowNo: number }>;

export async function importTourPoints(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  let deleted = 0;

  const groups = new Map<string, Group>();
  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const parent = await resolveParent("tour", raw.tourId, ctx);
    if ("error" in parent) {
      const code = parent.error === "tour_missing" ? "tour_point_needs_tour" : parent.error;
      out.push(errorRow(rowNo, cell.text(raw.title) ?? `#${rowNo}`, code));
      continue;
    }
    groups.set(parent.id, [...(groups.get(parent.id) ?? []), { raw, rowNo }]);
  }

  const tripBound = new Set(
    (
      await prisma.tripRoute.findMany({
        where: { userId: ctx.userId, kind: "tour", tripId: { not: null } },
        select: { id: true },
      })
    ).map((r) => r.id)
  );

  for (const [tourId, rows] of groups) {
    if (tripBound.has(tourId)) {
      // The trip's timeline is edited at the trip; this sheet only shows it.
      out.push(
        ...rows.map((r) => ({
          row: r.rowNo,
          action: "skip" as const,
          id: cell.text(r.raw.id) ?? null,
          label: cell.text(r.raw.title) ?? `#${r.rowNo}`,
        }))
      );
      continue;
    }
    const applied = await applyGroup(tourId, rows, ctx);
    deleted += applied.deleted;
    out.push(...applied.rows);
  }

  return summarise(
    sheet.key,
    out.sort((a, b) => a.row - b.row),
    deleted
  );
}

async function applyGroup(
  tourId: string,
  rows: Group,
  ctx: Ctx
): Promise<{ rows: RowOutcome[]; deleted: number }> {
  // A tour this dry run would create holds no points yet.
  const stops: StoredPoint[] = isPending(tourId)
    ? []
    : await prisma.tripStop.findMany({
        where: { routeId: tourId },
        orderBy: { routeOrderIdx: "asc" },
        select: { id: true, title: true, lat: true, lon: true, notes: true },
      });
  const byId = new Map(stops.map((s) => [s.id, s]));

  let parsed: Listed<TourPoint>[] = [];
  const groupOut: RowOutcome[] = [];
  for (const [i, r] of rows.entries()) {
    const result = parsePointRow(r.raw, r.rowNo, stops.length + i + 1, new Set(byId.keys()), ctx);
    if ("skip" in result) groupOut.push(result.skip);
    else if ("error" in result) groupOut.push(result.error);
    else parsed.push(result.ok);
  }

  // A row with no usable id may still mean a point already here: same name,
  // same place to about a hundred metres. Each point is claimed once.
  const matchExisting = claimMatcher(
    stops.filter((s) => !parsed.some((p) => p.item.id === s.id)),
    (s) => pointKey(s.title, s.lat, s.lon)
  );
  parsed = parsed.flatMap((p): Listed<TourPoint>[] => {
    if (p.item.id) return [p];
    const id = matchExisting(pointKey(p.item.title, p.item.lat, p.item.lon));
    if (!id) return [p];
    if (ctx.mode === "add") {
      groupOut.push({ row: p.rowNo, action: "skip", id, label: p.label, message: "exists" });
      return [];
    }
    return [{ ...p, item: { ...p.item, id } }];
  });

  const { list, removed } = mergeList(stops, parsed, ctx.mode, (i) => ({
    id: stops[i].id,
    title: stops[i].title,
    lat: stops[i].lat as number,
    lon: stops[i].lon as number,
  }));

  // The editor's own schema decides what a valid list is — ranges, title
  // length, the 500-point cap — so the sheet cannot write one it would refuse.
  const valid = tourPointsSchema.safeParse({
    points: list.map((l) => ({
      ...(l.item.id ? { id: l.item.id } : {}),
      title: l.item.title,
      lat: l.item.lat,
      lon: l.item.lon,
    })),
  }).success;
  if (groupOut.some((o) => o.action === "error") || parsed.length === 0 || !valid) {
    // One unreadable row holds its tour back: writing the rest would
    // renumber the list around a hole the reader did not ask for.
    return {
      deleted: 0,
      rows: [
        ...groupOut,
        ...parsed.map((p) =>
          valid
            ? { row: p.rowNo, action: "skip" as const, id: p.item.id ?? null, label: p.label }
            : errorRow(p.rowNo, p.label, "tour_points_refused")
        ),
      ],
    };
  }

  const { rows: listed, write } = listOutcome(
    stops.map((s) => s.id),
    list,
    removed,
    (item) => {
      const s = item.id ? byId.get(item.id) : undefined;
      return (
        s !== undefined &&
        s.title === item.title &&
        s.lat === item.lat &&
        s.lon === item.lon &&
        (item.notes === undefined || (s.notes ?? null) === (item.notes ?? null))
      );
    }
  );
  if (write && !ctx.dryRun) {
    try {
      await replaceTourPoints(
        ctx.userId,
        tourId,
        list.map((l) => l.item)
      );
      ctx.wrote = true;
    } catch (error) {
      logger.warn({ error, tourId }, "Spreadsheet import could not apply a tour's points");
      return {
        deleted: 0,
        rows: [
          ...groupOut,
          ...parsed.map((p) => errorRow(p.rowNo, p.label, "tour_points_refused")),
        ],
      };
    }
  }
  return { deleted: removed, rows: [...groupOut, ...listed] };
}
