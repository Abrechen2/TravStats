/**
 * Roadtrip costs from a spreadsheet (forgejo#140).
 *
 * The rules of every child sheet (`importSheets.ts`, `context.ts`): a row whose
 * id names one of the caller's roadtrip expenses updates it; any other row is
 * new here — recognised by its natural key (roadtrip, kind, amount, currency,
 * day) when an untouched one already matches, created otherwise. Its roadtrip
 * is found through `resolveParent`, so a roadtrip the same file just moved in
 * takes its costs along.
 *
 * A station or leg end is looked up ONLY among that roadtrip's stations: the
 * caller's own station by id, the station this run placed under the file's id
 * (a moved roadtrip), or the one station of that name. One that cannot be
 * found is dropped and reported, and the money stays — on the roadtrip,
 * unpinned. A refused row is one whose money cannot be read: no amount, or a
 * currency that is not one.
 *
 * Nothing is pruned in `replace` mode, for the reason stays and cruise stops
 * are not: costs go with their roadtrip, and a sheet merely filtered in Excel
 * must not cost the ones it hides.
 */

import { prisma } from "../../db";
import { isCurrencyCode } from "../../shared/currencies";
import { EXPENSE_KINDS } from "../../shared/expenses";
import { amountColumn, dateColumn } from "../expenses/expenseDto";
import * as cell from "./cells";
import { type Ctx, MATCHED, definedOnly, errorRow, isPending, norm } from "./context";
import { refName, resolveParent } from "./references";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell } from "./values";

type StationIndex = { byId: Set<string>; byTitle: Map<string, string[]>; via: Set<string> };

async function stationsOf(roadtripId: string): Promise<StationIndex> {
  const stops = isPending(roadtripId)
    ? []
    : await prisma.tripStop.findMany({
        where: { routeId: roadtripId },
        select: { id: true, title: true, viaPoint: true },
      });
  const byTitle = new Map<string, string[]>();
  for (const s of stops) byTitle.set(norm(s.title), [...(byTitle.get(norm(s.title)) ?? []), s.id]);
  return {
    byId: new Set(stops.map((s) => s.id)),
    byTitle,
    via: new Set(stops.filter((s) => s.viaPoint).map((s) => s.id)),
  };
}

/** A station cell → a station of THIS roadtrip, or undefined (blank) / null (not found). */
function stationOf(
  raw: string | undefined,
  index: StationIndex,
  ctx: Ctx
): string | null | undefined {
  if (!cell.text(raw)) return undefined;
  const fileId = cell.ref(raw);
  if (fileId && index.byId.has(fileId)) return fileId;
  const placed = fileId ? ctx.stationsByFileId.get(fileId) : undefined;
  if (placed && index.byId.has(placed)) return placed;
  const named = index.byTitle.get(norm(refName(raw)));
  return named?.length === 1 ? named[0] : null;
}

interface Pins {
  stopId?: string | null;
  legFromStopId?: string | null;
  legToStopId?: string | null;
}

/** The row's station and leg, each resolved or dropped; an error when it names both. */
function pinsOf(
  raw: Record<string, string>,
  index: StationIndex,
  ctx: Ctx,
  dropped: DroppedValue[]
): Pins | "both" {
  const resolve = (field: string, value: string | undefined) => {
    const id = stationOf(value, index, ctx);
    if (id === null) dropped.push({ field, value: value?.trim() ?? "" });
    return id;
  };
  const stopId = resolve("station", raw.stopId);
  const from = resolve("legFrom", raw.legFromStopId);
  const to = resolve("legTo", raw.legToStopId);
  if (stopId && (from || to)) return "both";
  // Nobody pays at a bend in the line: a route correction is no station.
  const pinned = stopId && index.via.has(stopId) ? null : stopId;
  if (stopId && pinned === null) dropped.push({ field: "station", value: raw.stopId.trim() });
  // Half a leg is no leg: both ends, or neither.
  const leg = from && to && from !== to ? { legFromStopId: from, legToStopId: to } : {};
  return { ...(pinned !== undefined ? { stopId: pinned } : {}), ...leg };
}

type Parsed =
  | { error: string }
  | {
      kind?: (typeof EXPENSE_KINDS)[number];
      amount: number;
      currency: string;
      date: string | null | undefined;
      note?: string;
      dropped: DroppedValue[];
    };

function parseMoney(raw: Record<string, string>): Parsed {
  const amount = cell.num(raw.amount);
  if (amount === undefined || Number.isNaN(amount) || amount < 0) {
    return { error: "expense_needs_amount" };
  }
  const currency = cell.text(raw.currency)?.toUpperCase();
  if (!isCurrencyCode(currency)) return { error: "invalid_currency" };
  const date = cell.isoDate(raw.date);
  if (date === null) return { error: "invalid_date" };
  const dropped: DroppedValue[] = [];
  const kind = enumCell(raw.kind, EXPENSE_KINDS, "expenseKind", dropped);
  return { kind, amount, currency, date, note: cell.text(raw.note), dropped };
}

export async function importRoadtripExpenses(
  sheet: IncomingSheet,
  ctx: Ctx
): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const stationCache = new Map<string, StationIndex>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const label =
      [cell.text(raw.kind), cell.text(raw.amount), cell.text(raw.currency)]
        .filter(Boolean)
        .join(" ") || `#${rowNo}`;
    const money = parseMoney(raw);
    if ("error" in money) {
      out.push(errorRow(rowNo, label, money.error));
      continue;
    }

    const fileId = cell.text(raw.id);
    const owned = fileId
      ? await prisma.tripExpense.findFirst({
          where: { id: fileId, userId: ctx.userId, routeId: { not: null } },
          select: { id: true, routeId: true },
        })
      : null;
    let roadtripId = owned?.routeId ?? null;
    if (!roadtripId) {
      const parent = await resolveParent("roadtrip", raw.roadtripId, ctx);
      if ("error" in parent) {
        const code = parent.error === "roadtrip_missing" ? "expense_needs_roadtrip" : parent.error;
        out.push(errorRow(rowNo, label, code));
        continue;
      }
      roadtripId = parent.id;
    }
    if (!stationCache.has(roadtripId)) stationCache.set(roadtripId, await stationsOf(roadtripId));
    // A roadtrip this dry run would create has no stations yet to look in:
    // the preview cannot resolve its pins, and must not report them dropped.
    const pins = isPending(roadtripId)
      ? {}
      : pinsOf(raw, stationCache.get(roadtripId)!, ctx, money.dropped);
    if (pins === "both") {
      out.push(errorRow(rowNo, label, "expense_station_or_leg"));
      continue;
    }

    const fields = definedOnly({
      kind: money.kind,
      amount: money.amount,
      currency: money.currency,
      date: money.date,
      note: money.note,
      ...pins,
    });
    const dropped = droppedOrNone(money.dropped);

    let targetId = owned?.id ?? null;
    if (!targetId && !isPending(roadtripId)) {
      const hit = await prisma.tripExpense.findFirst({
        where: {
          userId: ctx.userId,
          routeId: roadtripId,
          kind: money.kind ?? "other",
          amount: amountColumn(money.amount),
          currency: money.currency,
          date: dateColumn(money.date ?? null),
          id: { notIn: [...ctx.claimed] },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      targetId = hit?.id ?? null;
    }

    if (targetId) {
      ctx.claimed.add(targetId);
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists", dropped });
        continue;
      }
      const stored = await prisma.tripExpense.findUniqueOrThrow({ where: { id: targetId } });
      const data = changedOnly(fields, { ...stored, amount: stored.amount.toNumber() });
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message, dropped });
        continue;
      }
      // The stored row may hold the other kind of pin: a station replaces a
      // leg and a leg a station, never both at once.
      const clears =
        "stopId" in data && data.stopId
          ? { legFromStopId: null, legToStopId: null }
          : "legFromStopId" in data
            ? { stopId: null }
            : {};
      if (!ctx.dryRun) {
        await prisma.tripExpense.update({
          where: { id: targetId },
          data: {
            ...data,
            ...clears,
            ...(data.amount !== undefined ? { amount: amountColumn(data.amount) } : {}),
            ...("date" in data ? { date: dateColumn(data.date ?? null) } : {}),
          },
        });
        ctx.wrote = true;
      }
      out.push({ row: rowNo, action: "update", id: targetId, label, message, dropped });
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun && !isPending(roadtripId)) {
      const created = await prisma.tripExpense.create({
        data: {
          userId: ctx.userId,
          routeId: roadtripId,
          // An unknown kind is reported in `dropped`; the money is still "other".
          kind: money.kind ?? "other",
          amount: amountColumn(money.amount),
          currency: money.currency,
          date: dateColumn(money.date ?? null),
          note: money.note ?? null,
          stopId: pins.stopId ?? null,
          legFromStopId: pins.legFromStopId ?? null,
          legToStopId: pins.legToStopId ?? null,
        },
        select: { id: true },
      });
      newId = created.id;
      ctx.claimed.add(newId);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label, dropped });
  }

  return summarise(sheet.key, out, 0);
}
