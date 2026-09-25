/**
 * Roadtrips from a spreadsheet (2.7).
 *
 * The rules of every sheet (`importSheets.ts`, `context.ts`): a row whose id
 * names one of the caller's roadtrips updates it; no id, an unknown id or
 * another account's id means the roadtrip is new here — recognised by its
 * natural key (name + start day) when it already is, created otherwise. An
 * unknown vehicle is left empty and reported, never a reason to refuse the
 * row, and a row that changes nothing is not written.
 *
 * Their stations are a sheet of their own (`roadtripStations.ts`).
 */

import { prisma } from "../../db";
import { ROADTRIP_VEHICLES } from "../../shared/tour/roadtrip";
import { spanOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import * as cell from "./cells";
import {
  MATCHED,
  type Ctx,
  definedOnly,
  errorRow,
  keepDespiteError,
  labelForms,
  norm,
  pendingId,
  registerParent,
} from "./context";
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

interface OwnedRoadtrip {
  id: string;
  name: string;
  start: string | null;
}

async function ownedRoadtrips(userId: string): Promise<OwnedRoadtrip[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: { id: true, name: true, stops: { select: STATION_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    start: spanOf(r.stops).startDate?.slice(0, 10) ?? null,
  }));
}

/** Natural key: same name, and the same start day when the row names one. */
function recognise(
  owned: readonly OwnedRoadtrip[],
  ctx: Ctx,
  name: string | undefined,
  startDay: string | null
): OwnedRoadtrip | undefined {
  if (!name) return undefined;
  return owned.find(
    (r) =>
      !ctx.claimed.has(r.id) &&
      norm(r.name) === norm(name) &&
      (startDay === null || r.start === startDay)
  );
}

export async function importRoadtrips(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const owned = await ownedRoadtrips(ctx.userId);
  const ownedById = new Map(owned.map((r) => [r.id, r]));

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);
    const own = fileId ? ownedById.get(fileId) : undefined;

    const start = cell.int(raw.startOdometerKm);
    const end = cell.int(raw.endOdometerKm);
    if ((start !== undefined && Number.isNaN(start)) || (end !== undefined && Number.isNaN(end))) {
      keepDespiteError(seen, own?.id);
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }
    const dropped: DroppedValue[] = [];
    const fields = definedOnly({
      name: cell.text(raw.name),
      vehicle: enumCell(raw.vehicle, ROADTRIP_VEHICLES, "vehicle", dropped),
      vehicleName: cell.text(raw.vehicleName),
      startOdometerKm: start,
      endOdometerKm: end,
      notes: cell.text(raw.notes),
    });
    const extra = { dropped: droppedOrNone(dropped) };
    const labels = labelForms(fields.name);

    const startDay = cell.isoDate(raw.startDate)?.slice(0, 10) ?? null;
    const target = own ?? recognise(owned, ctx, fields.name, startDay);

    if (target) {
      ctx.claimed.add(target.id);
      seen.add(target.id);
      registerParent(ctx, "roadtrip", { fileId, id: target.id, labels });
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
      out.push(errorRow(rowNo, label, "roadtrip_needs_name"));
      continue;
    }
    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await prisma.tripRoute.create({
        data: { ...fields, name: fields.name, userId: ctx.userId, kind: "roadtrip", mode: "road" },
        select: { id: true },
      });
      newId = created.id;
      seen.add(newId);
      ctx.claimed.add(newId);
      ctx.wrote = true;
    }
    registerParent(ctx, "roadtrip", {
      fileId,
      id: newId ?? pendingId("roadtrips", rowNo),
      labels,
    });
    out.push({ row: rowNo, action: "create", id: newId, label, ...extra });
  }

  return summarise(sheet.key, out, await pruneRoutes("roadtrip", seen, ctx));
}
