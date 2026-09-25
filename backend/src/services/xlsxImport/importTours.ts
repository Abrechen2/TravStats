/**
 * Day tours and their points from a spreadsheet (2.7).
 *
 * The same owner rule as roadtrips (`importRoadtrips.ts`, 2026-09-25): a row
 * whose id names one of the caller's tours updates it; no id, or an id from
 * another account, creates one — unless a tour of the same name and start is
 * already here, which is recognised rather than doubled. Every id from the
 * file is looked up scoped by `userId`, so a foreign id only ever leads to a
 * NEW row in the caller's account.
 *
 * A tour created here is standalone: it owns its points. A tour that belongs
 * to a trip draws its points from the trip's timeline, which is edited at the
 * trip — so the point rows of such a tour in THIS account are skipped, never
 * written. A trip-bound tour moved from another account arrives standalone,
 * and its points come with it.
 *
 * Points are an ordered list with legs keyed by neighbouring points, so they
 * go through `replaceTourPoints` — the writer the tour editor uses — once per
 * tour. The order column is authoritative, decimals insert between, a point
 * the file does not mention keeps its place unless the mode is `replace`, and
 * one unreadable row holds its tour back.
 */

import { prisma } from "../../db";
import { tourPointsSchema } from "../../schemas/tour";
import { TOUR_ACTIVITIES } from "../../shared/tour/roadtrip";
import { LEG_MODES } from "../tour/tourDistance";
import { replaceTourPoints, type TourPoint } from "../tour/replaceTourPoints";
import logger from "../../utils/logger";
import * as cell from "./cells";
import { importRoadtrips, importRoadtripStations, stationFromFile } from "./importRoadtrips";
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

/** What the tour sheet tells the point sheet within ONE run. */
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

const PENDING = "pending:tour:";
/** Two points closer than this (~100 m, three decimals) with one name are one point. */
const MATCH_DECIMALS = 3;

function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

const norm = (name: string): string => name.trim().toLowerCase();

function refName(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return v.replace(/\s*\[[^\]]*\]\s*$/, "").trim() || undefined;
}

const isActivity = (v: string): boolean => (TOUR_ACTIVITIES as readonly string[]).includes(v);
const isMode = (v: string): boolean => (LEG_MODES as readonly string[]).includes(v);

/** A created tour's leg mode when the sheet names none: wheels for a ride, feet otherwise. */
function modeFor(activity: string | undefined): string {
  return activity === "bike" || activity === "mtb" ? "bike" : "foot";
}

// ------------------------------------------------------------------- tours

interface OwnedTour {
  id: string;
  name: string;
  tripId: string | null;
  /** The day the tour list shows as its start — first dated stop, else first recording. */
  start: string | null;
}

async function ownedTours(userId: string): Promise<OwnedTour[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour" },
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
 * unknown.
 */
function recognise(
  owned: readonly OwnedTour[],
  name: string | undefined,
  startDay: string | null
): OwnedTour | undefined {
  if (!name) return undefined;
  const named = owned.filter((r) => norm(r.name) === norm(name));
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
    const moved = stationFromFile(ctx, bracketId);
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

type TourParse = { fields: Record<string, string> } | { error: string };

function parseTourFields(raw: Record<string, string>): TourParse {
  const activity = cell.text(raw.activity);
  const mode = cell.text(raw.mode);
  if (activity !== undefined && !isActivity(activity)) return { error: "invalid_activity" };
  if (mode !== undefined && !isMode(mode)) return { error: "invalid_mode" };
  const fields = Object.fromEntries(
    Object.entries({
      name: cell.text(raw.name),
      activity,
      mode,
      notes: cell.text(raw.notes),
    }).filter((e): e is [string, string] => e[1] !== undefined)
  );
  return { fields };
}

export async function importTours(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const state = runState(ctx);
  const owned = await ownedTours(ctx.userId);
  const ownedById = new Map(owned.map((r) => [r.id, r]));

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);
    if (fileId && ownedById.has(fileId)) seen.add(fileId);

    const parsed = parseTourFields(raw);
    if ("error" in parsed) {
      out.push(errorRow(rowNo, label, parsed.error));
      continue;
    }
    const anchorStopId = await resolveAnchor(raw.anchorStopId, ctx);
    const fields: Record<string, string> = {
      ...parsed.fields,
      ...(anchorStopId ? { anchorStopId } : {}),
    };

    const startDay = cell.isoDate(raw.startDate)?.slice(0, 10) ?? null;
    const target =
      (fileId ? ownedById.get(fileId) : undefined) ?? recognise(owned, fields.name, startDay);

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
      out.push(errorRow(rowNo, label, "tour_needs_name"));
      continue;
    }
    const newId = ctx.dryRun ? `${PENDING}${rowNo}` : await createTour(ctx.userId, fields);
    seen.add(newId);
    if (fileId) state.byFileId.set(fileId, newId);
    const key = norm(fields.name);
    state.byName.set(key, new Set([...(state.byName.get(key) ?? []), newId]));
    out.push({ row: rowNo, action: "create", id: ctx.dryRun ? null : newId, label });
  }

  return summarise(sheet.key, out, await pruneTours(seen, ctx));
}

/** A standalone tour, placed last among the caller's trip-less ones as `POST /tours` does. */
async function createTour(userId: string, fields: Record<string, string>): Promise<string> {
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

/**
 * `replace` removes the tours the file left out, the way `DELETE
 * /tours/:routeId` removes one: a trip's timeline stops are released back to
 * the trip, the tour's own points go with it through the cascade.
 */
async function pruneTours(seen: Set<string>, ctx: Ctx): Promise<number> {
  if (ctx.mode !== "replace") return 0;
  const where = { userId: ctx.userId, kind: "tour", id: { notIn: [...seen] } };
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
      model: "tour",
      userId: ctx.userId,
      deleted: ids.length,
    },
    "Spreadsheet import in replace mode deleted rows absent from the file"
  );
  return ids.length;
}

// ------------------------------------------------------------------ points

interface ParsedPoint {
  rowNo: number;
  label: string;
  order: number;
  point: TourPoint;
}

type PointParse = { ok: ParsedPoint } | { error: RowOutcome } | { skip: RowOutcome };

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
    return { error: errorRow(rowNo, label, "tour_point_needs_point") };
  }
  if (!title) return { error: errorRow(rowNo, label, "tour_point_needs_title") };
  return {
    ok: {
      rowNo,
      label,
      order: order ?? fallbackOrder,
      point: { ...(id ? { id } : {}), title, lat, lon, notes: cell.text(raw.notes) ?? null },
    },
  };
}

function pointKey(title: string, lat: number | null, lon: number | null): string {
  return [norm(title), lat?.toFixed(MATCH_DECIMALS) ?? "", lon?.toFixed(MATCH_DECIMALS) ?? ""].join(
    "|"
  );
}

/** Resolve a point row's tour cell to an account id, a dry-run placeholder, or an error code. */
function resolveTour(
  raw: string | undefined,
  state: RunState,
  owned: readonly OwnedTour[]
): { id: string } | { error: string } {
  const bracketId = cell.ref(raw);
  if (bracketId) {
    const mapped = state.byFileId.get(bracketId);
    if (mapped) return { id: mapped };
    if (owned.some((r) => r.id === bracketId)) return { id: bracketId };
  }
  const name = refName(raw);
  // An id that resolves to nothing here is a tour we do not know, not a missing cell.
  if (!name) return { error: bracketId ? "unknown_tour" : "tour_point_needs_tour" };
  const candidates = new Set([
    ...owned.filter((r) => norm(r.name) === norm(name)).map((r) => r.id),
    ...(state.byName.get(norm(name)) ?? []),
  ]);
  if (candidates.size === 1) return { id: [...candidates][0] };
  return { error: candidates.size === 0 ? "unknown_tour" : "ambiguous_tour" };
}

type Group = Array<{ raw: Record<string, string>; rowNo: number }>;

export async function importTourPoints(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  let deleted = 0;
  const state = runState(ctx);
  const owned = await ownedTours(ctx.userId);
  const tripBound = new Set(owned.filter((r) => r.tripId !== null).map((r) => r.id));

  const groups = new Map<string, Group>();
  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const resolved = resolveTour(raw.tourId, state, owned);
    if ("error" in resolved) {
      out.push(errorRow(rowNo, cell.text(raw.title) ?? `#${rowNo}`, resolved.error));
      continue;
    }
    groups.set(resolved.id, [...(groups.get(resolved.id) ?? []), { raw, rowNo }]);
  }

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
  const stops = tourId.startsWith(PENDING)
    ? []
    : await prisma.tripStop.findMany({
        where: { routeId: tourId },
        orderBy: { routeOrderIdx: "asc" },
        select: { id: true, title: true, lat: true, lon: true, notes: true },
      });

  const knownIds = new Set(stops.map((s) => s.id));
  const parsed: ParsedPoint[] = [];
  const groupOut: RowOutcome[] = [];
  for (const [i, r] of rows.entries()) {
    const result = parsePointRow(r.raw, r.rowNo, stops.length + i + 1, knownIds, ctx);
    if ("skip" in result) groupOut.push(result.skip);
    else if ("error" in result) groupOut.push(result.error);
    else parsed.push(result.ok);
  }

  // A row with no usable id may still mean a point already here: same name,
  // same place to about a hundred metres. Each point is claimed once.
  const free = new Map<string, string[]>();
  for (const s of stops) {
    const k = pointKey(s.title, s.lat, s.lon);
    free.set(k, [...(free.get(k) ?? []), s.id]);
  }
  for (let i = parsed.length - 1; i >= 0; i--) {
    const p = parsed[i];
    if (p.point.id) continue;
    const id = free.get(pointKey(p.point.title, p.point.lat, p.point.lon))?.shift();
    if (!id) continue;
    if (ctx.mode === "add") {
      groupOut.push({ row: p.rowNo, action: "skip", id, label: p.label });
      parsed.splice(i, 1);
    } else {
      parsed[i] = { ...p, point: { ...p.point, id } };
    }
  }

  const mentioned = new Set(parsed.flatMap((p) => (p.point.id ? [p.point.id] : [])));
  const kept = stops.flatMap((s, i): ParsedPoint[] =>
    mentioned.has(s.id) || ctx.mode === "replace"
      ? []
      : [
          {
            rowNo: 0,
            label: s.title,
            order: i + 1,
            point: { id: s.id, title: s.title, lat: s.lat as number, lon: s.lon as number },
          },
        ]
  );
  const removed = ctx.mode === "replace" ? stops.filter((s) => !mentioned.has(s.id)).length : 0;
  const list = [...kept, ...parsed].sort((a, b) => a.order - b.order || a.rowNo - b.rowNo);

  // The editor's own schema decides what a valid list is — ranges, title
  // length, the 500-point cap — so the sheet cannot write one it would refuse.
  const valid = tourPointsSchema.safeParse({
    points: list.map((l) => ({
      ...(l.point.id ? { id: l.point.id } : {}),
      title: l.point.title,
      lat: l.point.lat,
      lon: l.point.lon,
    })),
  }).success;
  const held = groupOut.some((o) => o.action === "error") || parsed.length === 0 || !valid;
  if (held) {
    // One unreadable row holds its tour back: writing the rest would
    // renumber the list around a hole the reader did not ask for.
    const reason = valid ? "skip" : "error";
    return {
      deleted: 0,
      rows: [
        ...groupOut,
        ...parsed.map((p) =>
          reason === "error"
            ? errorRow(p.rowNo, p.label, "tour_points_refused")
            : { row: p.rowNo, action: "skip" as const, id: p.point.id ?? null, label: p.label }
        ),
      ],
    };
  }
  if (!ctx.dryRun) {
    try {
      await replaceTourPoints(
        ctx.userId,
        tourId,
        list.map((l) => l.point)
      );
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
  return {
    deleted: removed,
    rows: [
      ...groupOut,
      ...parsed.map((p) => ({
        row: p.rowNo,
        action: (p.point.id ? "update" : "create") as RowOutcome["action"],
        id: p.point.id ?? null,
        label: p.label,
      })),
    ],
  };
}

/**
 * The route-shaped sheets in the order they must run: roadtrips before their
 * stations, as places before their visits; tours after both, because a
 * tour's anchor may be a station this same file moved; points last.
 */
export const ROUTE_HANDLERS = {
  roadtrips: importRoadtrips,
  roadtripStations: importRoadtripStations,
  tours: importTours,
  tourPoints: importTourPoints,
} as const;
