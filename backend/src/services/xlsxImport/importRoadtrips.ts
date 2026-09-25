/**
 * Roadtrips and their stations from a spreadsheet (2.7).
 *
 * Owner rule for every sheet (2026-09-25): a row with an id updates the record
 * it names, a row without one creates. The security property of the importer
 * holds here too — every id from the file is looked up scoped by `userId`,
 * and a foreign id reads exactly like an unknown one.
 *
 * Stations are the one sheet that cannot be applied row by row. A roadtrip's
 * stations are an ORDERED list whose legs are keyed by neighbouring stations,
 * so they are written through `replaceStations` — the same writer the station
 * editor uses — once per roadtrip, with the order the sheet gives. The order
 * column is the authority: numbers sort the list, decimals insert between
 * (2.5 goes between 2 and 3), and a station the file does not mention keeps
 * its current place. Only `replace` removes the stations it leaves out.
 */

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { ROADTRIP_VEHICLES } from "../../shared/tour/roadtrip";
import { assertStaysOwned, replaceStations, type Station } from "../roadtrip/replaceStations";
import logger from "../../utils/logger";
import * as cell from "./cells";
import {
  summarise,
  type ImportMode,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";

interface Ctx {
  userId: string;
  dryRun: boolean;
  mode: ImportMode;
}

/** Same wording for "not yours" and "does not exist" — see importSheets.ts. */
const UNKNOWN_ID = "unknown_id";
const NIGHTS = ["stay", "free", "pass"] as const;

function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

function isVehicle(v: string): v is (typeof ROADTRIP_VEHICLES)[number] {
  return (ROADTRIP_VEHICLES as readonly string[]).includes(v);
}

// --------------------------------------------------------------- roadtrips

export async function importRoadtrips(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const id = cell.text(raw.id);

    const vehicle = cell.text(raw.vehicle);
    const start = cell.int(raw.startOdometerKm);
    const end = cell.int(raw.endOdometerKm);
    if (id) seen.add(id);
    if ((start !== undefined && Number.isNaN(start)) || (end !== undefined && Number.isNaN(end))) {
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }
    if (vehicle !== undefined && !isVehicle(vehicle)) {
      out.push(errorRow(rowNo, label, "invalid_vehicle"));
      continue;
    }
    const fields = Object.fromEntries(
      Object.entries({
        name: cell.text(raw.name),
        vehicle,
        vehicleName: cell.text(raw.vehicleName),
        startOdometerKm: start,
        endOdometerKm: end,
        notes: cell.text(raw.notes),
      }).filter(([, v]) => v !== undefined)
    );

    if (!id) {
      if (!fields.name) {
        out.push(errorRow(rowNo, label, "roadtrip_needs_name"));
        continue;
      }
      let newId: string | null = null;
      if (!ctx.dryRun) {
        const created = await prisma.tripRoute.create({
          data: {
            ...fields,
            name: fields.name as string,
            userId: ctx.userId,
            kind: "roadtrip",
            mode: "road",
          },
          select: { id: true },
        });
        newId = created.id;
        seen.add(newId);
      }
      out.push({ row: rowNo, action: "create", id: newId, label });
      continue;
    }

    const existing = await prisma.tripRoute.findFirst({
      where: { id, userId: ctx.userId, kind: "roadtrip" },
      select: { id: true },
    });
    if (!existing) {
      out.push(errorRow(rowNo, label, UNKNOWN_ID));
      continue;
    }
    if (ctx.mode === "add" || Object.keys(fields).length === 0) {
      out.push({ row: rowNo, action: "skip", id, label });
      continue;
    }
    if (!ctx.dryRun) await prisma.tripRoute.update({ where: { id }, data: fields });
    out.push({ row: rowNo, action: "update", id, label });
  }

  return summarise(sheet.key, out, await pruneRoadtrips(seen, ctx));
}

/**
 * `replace` removes the roadtrips the file left out, the way the delete
 * handler removes one: stops borrowed from a trip's timeline go back to it
 * (without their night columns), the roadtrip's own stations go with it.
 */
async function pruneRoadtrips(seen: Set<string>, ctx: Ctx): Promise<number> {
  if (ctx.mode !== "replace") return 0;
  const where = { userId: ctx.userId, kind: "roadtrip", id: { notIn: [...seen] } };
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
  logger.warn(
    {
      operation: "xlsx_import_replace_deleted",
      model: "roadtrip",
      userId: ctx.userId,
      deleted: ids.length,
    },
    "Spreadsheet import in replace mode deleted rows absent from the file"
  );
  return ids.length;
}

// ---------------------------------------------------------------- stations

interface ParsedStation {
  rowNo: number;
  label: string;
  order: number;
  station: Station;
}

type StationParse = { ok: ParsedStation } | { error: RowOutcome } | { skip: RowOutcome };

function parseStationRow(
  raw: Record<string, string>,
  rowNo: number,
  fallbackOrder: number,
  ctx: Ctx
): StationParse {
  const title = cell.text(raw.title);
  const label = title ?? `#${rowNo}`;
  const id = cell.text(raw.id);
  if (id && ctx.mode === "add") return { skip: { row: rowNo, action: "skip", id, label } };

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
    return { error: errorRow(rowNo, label, "station_needs_point") };
  }
  if (!title) return { error: errorRow(rowNo, label, "station_needs_title") };

  const kind = cell.text(raw.night) ?? "pass";
  if (!(NIGHTS as readonly string[]).includes(kind))
    return { error: errorRow(rowNo, label, "invalid_night") };
  const stayId = cell.ref(raw.lodgingStayId);
  if (kind === "stay" && !stayId) return { error: errorRow(rowNo, label, "station_needs_stay") };

  const startDate = cell.isoDate(raw.startDate);
  const endDate = cell.isoDate(raw.endDate);
  return {
    ok: {
      rowNo,
      label,
      order: order ?? fallbackOrder,
      station: {
        ...(id ? { id } : {}),
        title,
        lat,
        lon,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        notes: cell.text(raw.notes) ?? null,
        night:
          kind === "stay"
            ? { kind: "stay", lodgingStayId: stayId as string }
            : { kind: kind as "free" | "pass" },
      },
    },
  };
}

export async function importRoadtripStations(
  sheet: IncomingSheet,
  ctx: Ctx
): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  let deleted = 0;

  // Group by roadtrip, keeping the sheet's own row order as the tie-break.
  const groups = new Map<string, Array<{ raw: Record<string, string>; rowNo: number }>>();
  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const roadtripId = cell.ref(raw.roadtripId);
    if (!roadtripId) {
      out.push(errorRow(rowNo, cell.text(raw.title) ?? `#${rowNo}`, "station_needs_roadtrip"));
      continue;
    }
    groups.set(roadtripId, [...(groups.get(roadtripId) ?? []), { raw, rowNo }]);
  }

  for (const [roadtripId, rows] of groups) {
    const owned = await prisma.tripRoute.findFirst({
      where: { id: roadtripId, userId: ctx.userId, kind: "roadtrip" },
      select: {
        id: true,
        stops: {
          orderBy: { routeOrderIdx: "asc" },
          select: {
            id: true,
            title: true,
            lat: true,
            lon: true,
            startDate: true,
            endDate: true,
            notes: true,
            lodgingStayId: true,
            overnight: true,
          },
        },
      },
    });
    if (!owned) {
      for (const r of rows)
        out.push(errorRow(r.rowNo, cell.text(r.raw.title) ?? `#${r.rowNo}`, UNKNOWN_ID));
      continue;
    }

    const existingIds = new Set(owned.stops.map((s) => s.id));
    const parsed: ParsedStation[] = [];
    const groupOut: RowOutcome[] = [];
    for (const [i, r] of rows.entries()) {
      const result = parseStationRow(r.raw, r.rowNo, owned.stops.length + i + 1, ctx);
      if ("skip" in result) groupOut.push(result.skip);
      else if ("error" in result) groupOut.push(result.error);
      else if (result.ok.station.id && !existingIds.has(result.ok.station.id)) {
        groupOut.push(errorRow(r.rowNo, result.ok.label, UNKNOWN_ID));
      } else parsed.push(result.ok);
    }
    // Only a row that is applied replaces its station. A skipped row (an id
    // in `add` mode) leaves it where it is; a refused row holds the whole
    // roadtrip back below — "unreadable" never means "remove".
    const mentioned = new Set(parsed.flatMap((p) => (p.station.id ? [p.station.id] : [])));

    // Stations the file does not mention keep their current position (1..n)
    // — unless the mode is `replace`, where leaving one out removes it.
    const kept = owned.stops.flatMap((s, i): ParsedStation[] =>
      mentioned.has(s.id) || ctx.mode === "replace"
        ? []
        : [
            {
              rowNo: 0,
              label: s.title,
              order: i + 1,
              station: {
                id: s.id,
                title: s.title,
                lat: s.lat as number,
                lon: s.lon as number,
                startDate: s.startDate,
                endDate: s.endDate,
                notes: s.notes,
                night: s.lodgingStayId
                  ? { kind: "stay", lodgingStayId: s.lodgingStayId }
                  : { kind: s.overnight ? "free" : "pass" },
              },
            },
          ]
    );
    const removed =
      ctx.mode === "replace" ? owned.stops.filter((s) => !mentioned.has(s.id)).length : 0;
    const list = [...kept, ...parsed].sort((a, b) => a.order - b.order || a.rowNo - b.rowNo);

    const written = parsed.map((p) => ({
      row: p.rowNo,
      action: (p.station.id ? "update" : "create") as RowOutcome["action"],
      id: p.station.id ?? null,
      label: p.label,
    }));
    if (groupOut.some((o) => o.action === "error") || parsed.length === 0) {
      // One unreadable row holds its roadtrip back: writing the rest would
      // renumber the list around a hole the reader did not ask for.
      out.push(
        ...groupOut,
        ...parsed.map((p) => ({
          row: p.rowNo,
          action: "skip" as const,
          id: p.station.id ?? null,
          label: p.label,
        }))
      );
      continue;
    }
    try {
      // The preview must refuse what the real run would: a stay that is not
      // the caller's is checked in the dry run too.
      await assertStaysOwned(
        ctx.userId,
        list.map((l) => l.station)
      );
      if (!ctx.dryRun)
        await replaceStations(
          ctx.userId,
          roadtripId,
          list.map((l) => l.station)
        );
    } catch (error) {
      const message =
        error instanceof AppError && error.statusCode === 404
          ? "unknown_stay"
          : "station_list_refused";
      out.push(...groupOut, ...parsed.map((p) => errorRow(p.rowNo, p.label, message)));
      continue;
    }
    deleted += removed;
    out.push(...groupOut, ...written);
  }

  return summarise(
    sheet.key,
    out.sort((a, b) => a.row - b.row),
    deleted
  );
}
