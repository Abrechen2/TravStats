/**
 * Roadtrip stations from a spreadsheet (2.7).
 *
 * The one sheet besides tour points that cannot be applied row by row: a
 * roadtrip's stations are an ORDERED list whose legs are keyed by
 * neighbouring stations, so they go through `replaceStations` — the writer
 * the station editor uses — once per roadtrip (see `routeLists.ts`). The order
 * column is the authority, decimals insert between (2.5 goes between 2 and
 * 3), and a station the file does not mention keeps its place; only `replace`
 * removes it. One unreadable row holds its roadtrip back.
 *
 * A station finds its roadtrip through `resolveParent` like every child row:
 * the caller's own id, the roadtrip this run placed under the file's id, or
 * the name when exactly one roadtrip has it. A row with no usable station id
 * is matched to a station already here by name, arrival day and place, so a
 * moved file read twice converges. An unknown night is left out and
 * reported: a stored station keeps its night, a new one passes through.
 */

import { prisma } from "../../db";
import { replaceStations, type Station } from "../roadtrip/replaceStations";
import logger from "../../utils/logger";
import * as cell from "./cells";
import { type Ctx, dayOf, errorRow, isPending, norm } from "./context";
import { refName, resolveParent } from "./references";
import { claimMatcher, coordKey, listOutcome, mergeList, type Listed } from "./routeLists";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { enumCell } from "./values";

const NIGHTS = ["stay", "free", "pass"] as const;

type Stored = Awaited<ReturnType<typeof storedStations>>[number];

function storedStations(roadtripId: string) {
  return prisma.tripStop.findMany({
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
}

function storedNight(s: Stored): Station["night"] {
  if (s.lodgingStayId) return { kind: "stay", lodgingStayId: s.lodgingStayId };
  return { kind: s.overnight ? "free" : "pass" };
}

function toStation(s: Stored): Station {
  return {
    id: s.id,
    title: s.title,
    lat: s.lat as number,
    lon: s.lon as number,
    startDate: s.startDate,
    endDate: s.endDate,
    notes: s.notes,
    night: storedNight(s),
  };
}

interface ParsedStation extends Listed<Station> {
  /** The readable half of the stay cell — what a moved stay is found by. */
  stayName?: string;
}

type StationParse = { ok: ParsedStation } | { error: RowOutcome } | { skip: RowOutcome };

function parseStationRow(
  raw: Record<string, string>,
  rowNo: number,
  fallbackOrder: number,
  stored: ReadonlyMap<string, Stored>,
  ctx: Ctx
): StationParse {
  const title = cell.text(raw.title);
  const label = title ?? `#${rowNo}`;
  // An id this roadtrip does not hold — another account's, or a typo — is a
  // new station, not a refused one: that is what a moved file carries.
  const rawId = cell.text(raw.id);
  const known = rawId ? stored.get(rawId) : undefined;
  if (known && ctx.mode === "add") {
    return { skip: { row: rowNo, action: "skip", id: known.id, label, message: "exists" } };
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
    return { error: errorRow(rowNo, label, "station_needs_point") };
  }
  if (!title) return { error: errorRow(rowNo, label, "station_needs_title") };

  const dropped: DroppedValue[] = [];
  const kind = enumCell(raw.night, NIGHTS, "night", dropped);
  const stayId = cell.ref(raw.lodgingStayId);
  if (kind === "stay" && !stayId) return { error: errorRow(rowNo, label, "station_needs_stay") };
  const night: Station["night"] =
    kind === "stay"
      ? { kind: "stay", lodgingStayId: stayId as string }
      : kind
        ? { kind }
        : known
          ? storedNight(known)
          : { kind: "pass" };

  const startDate = cell.isoDate(raw.startDate);
  const endDate = cell.isoDate(raw.endDate);
  return {
    ok: {
      rowNo,
      label,
      order: order ?? fallbackOrder,
      fileId: rawId,
      dropped,
      stayName: refName(raw.lodgingStayId),
      item: {
        ...(known ? { id: known.id } : {}),
        title,
        lat,
        lon,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        notes: cell.text(raw.notes) ?? null,
        night,
      },
    },
  };
}

/**
 * A stay link the caller cannot have — another account's, from a moved file —
 * never reaches the station as it is: linking it would read someone else's
 * stay back. It is looked up in THIS account instead, by the house's name and
 * the day of arrival, which finds the stay the lodging sheet of the same file
 * just moved over. With no such stay the station keeps its night as a free
 * one: the night happened, the booking is simply not in this account.
 */
async function relinkStays(userId: string, parsed: ParsedStation[]): Promise<ParsedStation[]> {
  const ids = parsed.flatMap((p) =>
    p.item.night.kind === "stay" ? [p.item.night.lodgingStayId] : []
  );
  if (ids.length === 0) return parsed;
  const owned = new Set(
    (
      await prisma.lodgingStay.findMany({
        where: { id: { in: ids }, userId },
        select: { id: true },
      })
    ).map((s) => s.id)
  );
  const out: ParsedStation[] = [];
  for (const p of parsed) {
    const night = p.item.night;
    if (night.kind !== "stay" || owned.has(night.lodgingStayId)) {
      out.push(p);
      continue;
    }
    const day = dayOf(p.item.startDate);
    const candidates =
      p.stayName && day
        ? await prisma.lodgingStay.findMany({
            where: {
              userId,
              lodging: { name: { equals: p.stayName, mode: "insensitive" } },
              checkIn: { gte: new Date(`${day}T00:00:00Z`), lt: new Date(`${day}T23:59:59.999Z`) },
            },
            select: { id: true },
          })
        : [];
    const relinked: Station["night"] =
      candidates.length === 1
        ? { kind: "stay", lodgingStayId: candidates[0].id }
        : { kind: "free" };
    out.push({ ...p, item: { ...p.item, night: relinked } });
  }
  return out;
}

const stationKey = (
  title: string,
  lat: number | null,
  lon: number | null,
  start: Date | null | undefined
): string => [norm(title), dayOf(start) ?? "", coordKey(lat), coordKey(lon)].join("|");

function sameStation(a: Station, b: Station): boolean {
  const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);
  const stay = (s: Station) => (s.night.kind === "stay" ? s.night.lodgingStayId : "");
  return (
    a.title === b.title &&
    a.lat === b.lat &&
    a.lon === b.lon &&
    time(a.startDate) === time(b.startDate) &&
    time(a.endDate) === time(b.endDate) &&
    (a.notes ?? null) === (b.notes ?? null) &&
    a.night.kind === b.night.kind &&
    stay(a) === stay(b)
  );
}

type Group = Array<{ raw: Record<string, string>; rowNo: number }>;

export async function importRoadtripStations(
  sheet: IncomingSheet,
  ctx: Ctx
): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  let deleted = 0;

  // Group by roadtrip, keeping the sheet's own row order as the tie-break.
  const groups = new Map<string, Group>();
  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const parent = await resolveParent("roadtrip", raw.roadtripId, ctx);
    if ("error" in parent) {
      const code = parent.error === "roadtrip_missing" ? "station_needs_roadtrip" : parent.error;
      out.push(errorRow(rowNo, cell.text(raw.title) ?? `#${rowNo}`, code));
      continue;
    }
    groups.set(parent.id, [...(groups.get(parent.id) ?? []), { raw, rowNo }]);
  }

  for (const [roadtripId, rows] of groups) {
    const applied = await applyGroup(roadtripId, rows, ctx);
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
  roadtripId: string,
  rows: Group,
  ctx: Ctx
): Promise<{ rows: RowOutcome[]; deleted: number }> {
  // A roadtrip this dry run would create holds no stations yet.
  const stops = isPending(roadtripId) ? [] : await storedStations(roadtripId);
  const byId = new Map(stops.map((s) => [s.id, s]));

  let parsed: ParsedStation[] = [];
  const groupOut: RowOutcome[] = [];
  for (const [i, r] of rows.entries()) {
    const result = parseStationRow(r.raw, r.rowNo, stops.length + i + 1, byId, ctx);
    if ("skip" in result) groupOut.push(result.skip);
    else if ("error" in result) groupOut.push(result.error);
    else parsed.push(result.ok);
  }

  // A row with no usable id may still mean a station already here.
  const matchExisting = claimMatcher(
    stops.filter((s) => !parsed.some((p) => p.item.id === s.id)),
    (s) => stationKey(s.title, s.lat, s.lon, s.startDate)
  );
  parsed = parsed.flatMap((p): ParsedStation[] => {
    if (p.item.id) return [p];
    const id = matchExisting(stationKey(p.item.title, p.item.lat, p.item.lon, p.item.startDate));
    if (!id) return [p];
    if (ctx.mode === "add") {
      if (p.fileId) ctx.stationsByFileId.set(p.fileId, id);
      groupOut.push({ row: p.rowNo, action: "skip", id, label: p.label, message: "exists" });
      return [];
    }
    return [{ ...p, item: { ...p.item, id } }];
  });

  // One unreadable row holds its roadtrip back: writing the rest would
  // renumber the list around a hole the reader did not ask for. A refused row
  // means "unreadable", never "remove".
  if (groupOut.some((o) => o.action === "error") || parsed.length === 0) {
    return {
      deleted: 0,
      rows: [
        ...groupOut,
        ...parsed.map((p) => ({
          row: p.rowNo,
          action: "skip" as const,
          id: p.item.id ?? null,
          label: p.label,
        })),
      ],
    };
  }

  parsed = await relinkStays(ctx.userId, parsed);
  const { list, removed } = mergeList(stops, parsed, ctx.mode, (i) => toStation(stops[i]));
  const { rows: listed, write } = listOutcome(
    stops.map((s) => s.id),
    list,
    removed,
    (item) => {
      const s = item.id ? byId.get(item.id) : undefined;
      return s !== undefined && sameStation(item, toStation(s));
    }
  );

  if (!write) {
    for (const l of list) if (l.fileId && l.item.id) ctx.stationsByFileId.set(l.fileId, l.item.id);
  } else if (!ctx.dryRun) {
    try {
      const { stations } = await replaceStations(
        ctx.userId,
        roadtripId,
        list.map((l) => l.item)
      );
      ctx.wrote = true;
      // The writer numbers the list 0..n in the order given.
      list.forEach((l, i) => {
        if (l.fileId && stations[i]) ctx.stationsByFileId.set(l.fileId, stations[i].id);
      });
    } catch (error) {
      logger.warn({ error, roadtripId }, "Spreadsheet import could not apply a station list");
      return {
        deleted: 0,
        rows: [
          ...groupOut,
          ...parsed.map((p) => errorRow(p.rowNo, p.label, "station_list_refused")),
        ],
      };
    }
  }
  return { deleted: removed, rows: [...groupOut, ...listed] };
}
