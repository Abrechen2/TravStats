/**
 * Day tours from a spreadsheet (2.7).
 *
 * The rules of every sheet (`importSheets.ts`, `context.ts`): a row whose id
 * names one of the caller's tours updates it; no id, an unknown id or another
 * account's id means the tour is new here — recognised by name and start day
 * when it already is, created otherwise. An unknown activity or travel mode
 * is left empty and reported, never a reason to refuse the row, and a row
 * that changes nothing is not written.
 *
 * A tour created here is standalone: it owns its points (`tourPoints.ts`). A
 * trip-bound tour moved from another account arrives standalone, and its
 * points come with it.
 */

import { prisma } from "../../db";
import { TOUR_ACTIVITIES } from "../../shared/tour/roadtrip";
import { LEG_MODES } from "../tour/tourDistance";
import * as cell from "./cells";
import {
  MATCHED,
  type Ctx,
  definedOnly,
  errorRow,
  labelForms,
  norm,
  pendingId,
  registerParent,
} from "./context";
import { refName } from "./references";
import { pruneRoutes } from "./routeLists";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell } from "./values";

/** A created tour's leg mode when the sheet names none: wheels for a ride, feet otherwise. */
function modeFor(activity: string | undefined): string {
  return activity === "bike" || activity === "mtb" ? "bike" : "foot";
}

export interface OwnedTour {
  id: string;
  name: string;
  tripId: string | null;
  /** The day the tour list shows as its start — first dated stop, else first recording. */
  start: string | null;
}

export async function ownedTours(userId: string): Promise<OwnedTour[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      tripId: true,
      stops: { select: { startDate: true } },
      tracks: { select: { startedAt: true }, orderBy: { startedAt: "asc" }, take: 1 },
    },
  });
  return rows.map((r) => {
    const dated = r.stops.flatMap((s) => (s.startDate ? [s.startDate.getTime()] : []));
    const first = dated.length > 0 ? new Date(Math.min(...dated)) : r.tracks[0]?.startedAt;
    return {
      id: r.id,
      name: r.name,
      tripId: r.tripId,
      start: first ? first.toISOString().slice(0, 10) : null,
    };
  });
}

/**
 * Which tour of this account a row without a usable id means. A moved
 * standalone tour has no dated points and no recording here, so its start is
 * unknown — and an unknown start does not contradict the file's. Without
 * that, the second read of a moved file would create every tour again. A
 * tour whose start matches exactly is preferred over one whose start is
 * unknown; each tour is claimed once per run.
 */
function recognise(
  owned: readonly OwnedTour[],
  ctx: Ctx,
  name: string | undefined,
  startDay: string | null
): OwnedTour | undefined {
  if (!name) return undefined;
  const named = owned.filter((r) => !ctx.claimed.has(r.id) && norm(r.name) === norm(name));
  if (startDay === null) return named[0];
  return named.find((r) => r.start === startDay) ?? named.find((r) => r.start === null);
}

/**
 * The anchor cell as an account station id: the station this run moved over
 * under the file's id, else a station of the caller's own roadtrips, else the
 * one roadtrip station with that title. Unresolvable is `undefined` — the
 * tour is never refused for it, and an existing anchor is not cleared by a
 * cell that could not be read.
 */
async function resolveAnchor(raw: string | undefined, ctx: Ctx): Promise<string | undefined> {
  const bracketId = cell.ref(raw);
  if (bracketId) {
    const moved = ctx.stationsByFileId.get(bracketId);
    if (moved) return moved;
    const own = await prisma.tripStop.findFirst({
      where: { id: bracketId, route: { userId: ctx.userId, kind: "roadtrip" } },
      select: { id: true },
    });
    if (own) return own.id;
  }
  const title = refName(raw);
  if (!title) return undefined;
  const byTitle = await prisma.tripStop.findMany({
    where: {
      title: { equals: title, mode: "insensitive" },
      route: { userId: ctx.userId, kind: "roadtrip" },
    },
    select: { id: true },
    take: 2,
  });
  return byTitle.length === 1 ? byTitle[0].id : undefined;
}

export async function importTours(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const owned = await ownedTours(ctx.userId);
  const ownedById = new Map(owned.map((r) => [r.id, r]));

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);
    const own = fileId ? ownedById.get(fileId) : undefined;

    const dropped: DroppedValue[] = [];
    const fields = definedOnly({
      name: cell.text(raw.name),
      activity: enumCell(raw.activity, TOUR_ACTIVITIES, "activity", dropped),
      mode: enumCell(raw.mode, LEG_MODES, "mode", dropped),
      notes: cell.text(raw.notes),
      anchorStopId: await resolveAnchor(raw.anchorStopId, ctx),
    });
    const extra = { dropped: droppedOrNone(dropped) };
    const labels = labelForms(fields.name);

    const startDay = cell.isoDate(raw.startDate)?.slice(0, 10) ?? null;
    const target = own ?? recognise(owned, ctx, fields.name, startDay);

    if (target) {
      ctx.claimed.add(target.id);
      seen.add(target.id);
      registerParent(ctx, "tour", { fileId, id: target.id, labels });
      const message = own ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: target.id, label, message: "exists" });
        continue;
      }
      const stored = await prisma.tripRoute.findUniqueOrThrow({ where: { id: target.id } });
      const data = changedOnly(fields, stored);
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: target.id, label, message, ...extra });
        continue;
      }
      if (!ctx.dryRun) await prisma.tripRoute.update({ where: { id: target.id }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: target.id, label, message, ...extra });
      continue;
    }

    if (!fields.name) {
      out.push(errorRow(rowNo, label, "tour_needs_name"));
      continue;
    }
    let newId: string | null = null;
    if (!ctx.dryRun) {
      newId = await createTour(ctx.userId, { ...fields, name: fields.name });
      seen.add(newId);
      ctx.claimed.add(newId);
      ctx.wrote = true;
    }
    registerParent(ctx, "tour", { fileId, id: newId ?? pendingId("tours", rowNo), labels });
    out.push({ row: rowNo, action: "create", id: newId, label, ...extra });
  }

  return summarise(sheet.key, out, await pruneRoutes("tour", seen, ctx));
}

/** A standalone tour, placed last among the caller's trip-less ones as `POST /tours` does. */
async function createTour(
  userId: string,
  fields: { name: string; activity?: string; mode?: string; notes?: string; anchorStopId?: string }
): Promise<string> {
  const last = await prisma.tripRoute.findFirst({
    where: { userId, tripId: null },
    orderBy: { orderIdx: "desc" },
    select: { orderIdx: true },
  });
  const created = await prisma.tripRoute.create({
    data: {
      userId,
      tripId: null,
      kind: "tour",
      name: fields.name,
      mode: fields.mode ?? modeFor(fields.activity),
      activity: fields.activity ?? null,
      notes: fields.notes ?? null,
      anchorStopId: fields.anchorStopId ?? null,
      orderIdx: last ? last.orderIdx + 1 : 0,
    },
    select: { id: true },
  });
  return created.id;
}
