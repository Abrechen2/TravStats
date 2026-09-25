/**
 * Roadtrips and their stations from a spreadsheet (2.7).
 *
 * Owner rule for every sheet (2026-09-25): the workbook is for editing AND
 * moving entries. A row whose id names one of the caller's roadtrips updates
 * it; a row without an id — or with an id from another account, which is what
 * a file moved between accounts carries — creates one, unless a roadtrip of
 * the same name and start is already here, which is recognised rather than
 * doubled. The security property holds throughout: every id from the file is
 * looked up scoped by `userId`, so a foreign id can only ever lead to a NEW
 * row in the caller's account, never to someone else's.
 *
 * Stations are the one sheet that cannot be applied row by row. A roadtrip's
 * stations are an ORDERED list whose legs are keyed by neighbouring stations,
 * so they are written through `replaceStations` — the same writer the station
 * editor uses — once per roadtrip, with the order the sheet gives. The order
 * column is the authority: numbers sort the list, decimals insert between
 * (2.5 goes between 2 and 3), and a station the file does not mention keeps
 * its current place. Only `replace` removes the stations it leaves out.
 *
 * A station finds its roadtrip by the id in its reference cell — the file's
 * id, which this run maps to the roadtrip it created or recognised — or, with
 * no id in brackets, by the roadtrip's name when exactly one has it.
 */

import { prisma } from "../../db";
import { ROADTRIP_VEHICLES } from "../../shared/tour/roadtrip";
import { replaceStations, type Station } from "../roadtrip/replaceStations";
import { spanOf, STATION_SELECT } from "../roadtrip/roadtripSummary";
import logger from "../../utils/logger";
import * as cell from "./cells";
import {
  summarise,
  type ImportMode,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";

/** The part of the importer's context these handlers read. */
interface Ctx {
  userId: string;
  dryRun: boolean;
  mode: ImportMode;
}

/**
 * What the roadtrip sheet tells the station sheet within ONE run: which
 * account roadtrip each file id became, and which names this run placed.
 * Keyed by the run's context object, so it lives exactly as long as the run.
 */
interface RunState {
  byFileId: Map<string, string>;
  byName: Map<string, Set<string>>;
}
const runs = new WeakMap<object, RunState>();
function runState(ctx: Ctx): RunState {
  let state = runs.get(ctx);
  if (!state) {
    state = { byFileId: new Map(), byName: new Map() };
    runs.set(ctx, state);
  }
  return state;
}

const PENDING = "pending:roadtrip:";
const NIGHTS = ["stay", "free", "pass"] as const;

function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

function isVehicle(v: string): v is (typeof ROADTRIP_VEHICLES)[number] {
  return (ROADTRIP_VEHICLES as readonly string[]).includes(v);
}

const norm = (name: string): string => name.trim().toLowerCase();

/** The readable half of a "Name [id]" reference cell. */
function refName(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return v.replace(/\s*\[[^\]]*\]\s*$/, "").trim() || undefined;
}

// --------------------------------------------------------------- roadtrips

interface OwnedRoadtrip {
  id: string;
  name: string;
  start: string | null;
}

async function ownedRoadtrips(userId: string): Promise<OwnedRoadtrip[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: { id: true, name: true, stops: { select: STATION_SELECT } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    start: spanOf(r.stops).startDate?.slice(0, 10) ?? null,
  }));
}

export async function importRoadtrips(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const state = runState(ctx);
  const owned = await ownedRoadtrips(ctx.userId);
  const ownedById = new Map(owned.map((r) => [r.id, r]));

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);

    const vehicle = cell.text(raw.vehicle);
    const start = cell.int(raw.startOdometerKm);
    const end = cell.int(raw.endOdometerKm);
    if (fileId && ownedById.has(fileId)) seen.add(fileId);
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

    // Which roadtrip of THIS account the row means: its own id, else the one
    // already here under the same name and start (a moved file read twice).
    const startDay = cell.isoDate(raw.startDate)?.slice(0, 10) ?? null;
    const target =
      (fileId ? ownedById.get(fileId) : undefined) ??
      (fields.name
        ? owned.filter(
            (r) =>
              norm(r.name) === norm(fields.name as string) &&
              (startDay === null || r.start === startDay)
          )
        : []
      ).at(0);

    if (target) {
      seen.add(target.id);
      if (fileId) state.byFileId.set(fileId, target.id);
      const skip = ctx.mode === "add" || Object.keys(fields).length === 0;
      if (!skip && !ctx.dryRun) {
        await prisma.tripRoute.update({ where: { id: target.id }, data: fields });
      }
      out.push({ row: rowNo, action: skip ? "skip" : "update", id: target.id, label });
      continue;
    }

    if (!fields.name) {
      out.push(errorRow(rowNo, label, "roadtrip_needs_name"));
      continue;
    }
    const newId = ctx.dryRun
      ? `${PENDING}${rowNo}`
      : (
          await prisma.tripRoute.create({
            data: {
              ...fields,
              name: fields.name as string,
              userId: ctx.userId,
              kind: "roadtrip",
              mode: "road",
            },
            select: { id: true },
          })
        ).id;
    seen.add(newId);
    if (fileId) state.byFileId.set(fileId, newId);
    const key = norm(fields.name as string);
    state.byName.set(key, new Set([...(state.byName.get(key) ?? []), newId]));
    out.push({ row: rowNo, action: "create", id: ctx.dryRun ? null : newId, label });
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
  knownIds: ReadonlySet<string>,
  ctx: Ctx
): StationParse {
  const title = cell.text(raw.title);
  const label = title ?? `#${rowNo}`;
  // An id this roadtrip does not hold — another account's, or a typo — is a
  // new station, not a refused one: that is what a moved file carries.
  const rawId = cell.text(raw.id);
  const id = rawId && knownIds.has(rawId) ? rawId : undefined;
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

/**
 * A stay link the caller cannot have — another account's, from a moved file —
 * is dropped, and the station keeps its night as a free one: the night
 * happened, the booking record is simply not in this account. Linking it
 * would read someone else's stay back through the station.
 */
async function keepOnlyOwnStays(userId: string, stations: Station[]): Promise<Station[]> {
  const ids = stations.flatMap((s) => (s.night.kind === "stay" ? [s.night.lodgingStayId] : []));
  if (ids.length === 0) return stations;
  const owned = new Set(
    (
      await prisma.lodgingStay.findMany({
        where: { id: { in: ids }, userId },
        select: { id: true },
      })
    ).map((s) => s.id)
  );
  return stations.map((s) =>
    s.night.kind === "stay" && !owned.has(s.night.lodgingStayId)
      ? { ...s, night: { kind: "free" } }
      : s
  );
}

/** Resolve a station row's roadtrip cell to an account id, a dry-run placeholder, or an error code. */
function resolveRoadtrip(
  raw: string | undefined,
  state: RunState,
  owned: readonly OwnedRoadtrip[]
): { id: string } | { error: string } {
  const bracketId = cell.ref(raw);
  if (bracketId) {
    const mapped = state.byFileId.get(bracketId);
    if (mapped) return { id: mapped };
    if (owned.some((r) => r.id === bracketId)) return { id: bracketId };
  }
  const name = refName(raw);
  if (!name) return { error: "station_needs_roadtrip" };
  const candidates = new Set([
    ...owned.filter((r) => norm(r.name) === norm(name)).map((r) => r.id),
    ...(state.byName.get(norm(name)) ?? []),
  ]);
  if (candidates.size === 1) return { id: [...candidates][0] };
  return { error: candidates.size === 0 ? "unknown_roadtrip" : "ambiguous_roadtrip" };
}

export async function importRoadtripStations(
  sheet: IncomingSheet,
  ctx: Ctx
): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  let deleted = 0;
  const state = runState(ctx);
  const owned = await ownedRoadtrips(ctx.userId);

  // Group by roadtrip, keeping the sheet's own row order as the tie-break.
  const groups = new Map<string, Array<{ raw: Record<string, string>; rowNo: number }>>();
  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const resolved = resolveRoadtrip(raw.roadtripId, state, owned);
    if ("error" in resolved) {
      out.push(errorRow(rowNo, cell.text(raw.title) ?? `#${rowNo}`, resolved.error));
      continue;
    }
    groups.set(resolved.id, [...(groups.get(resolved.id) ?? []), { raw, rowNo }]);
  }

  for (const [roadtripId, rows] of groups) {
    // A roadtrip this dry run would create holds no stations yet.
    const stops = roadtripId.startsWith(PENDING)
      ? []
      : await prisma.tripStop.findMany({
          where: { routeId: roadtripId },
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
        });

    const knownIds = new Set(stops.map((s) => s.id));
    const parsed: ParsedStation[] = [];
    const groupOut: RowOutcome[] = [];
    for (const [i, r] of rows.entries()) {
      const result = parseStationRow(r.raw, r.rowNo, stops.length + i + 1, knownIds, ctx);
      if ("skip" in result) groupOut.push(result.skip);
      else if ("error" in result) groupOut.push(result.error);
      else parsed.push(result.ok);
    }
    // Only a row that is applied replaces its station. A skipped row (an id
    // in `add` mode) leaves it where it is; a refused row holds the whole
    // roadtrip back below — "unreadable" never means "remove".
    const mentioned = new Set(parsed.flatMap((p) => (p.station.id ? [p.station.id] : [])));

    // Stations the file does not mention keep their current position (1..n)
    // — unless the mode is `replace`, where leaving one out removes it.
    const kept = stops.flatMap((s, i): ParsedStation[] =>
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
    const removed = ctx.mode === "replace" ? stops.filter((s) => !mentioned.has(s.id)).length : 0;
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
    if (!ctx.dryRun) {
      try {
        const stations = await keepOnlyOwnStays(
          ctx.userId,
          list.map((l) => l.station)
        );
        await replaceStations(ctx.userId, roadtripId, stations);
      } catch (error) {
        logger.warn({ error, roadtripId }, "Spreadsheet import could not apply a station list");
        out.push(
          ...groupOut,
          ...parsed.map((p) => errorRow(p.rowNo, p.label, "station_list_refused"))
        );
        continue;
      }
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
