/**
 * Places and their visits.
 *
 * Natural keys, used when a row carries no id of this account:
 *   - place: name + position (to ~11 m), or name + city when the row has no
 *     coordinates;
 *   - visit: place + visit day. Two orders at the same restaurant on the same
 *     day are two visits (the McDonald's case), and still converge on a second
 *     import: every record a run touches is claimed, so the second row of a
 *     pair matches the second visit, not the first again.
 */

import { prisma } from "../../db";
import { createPlaceSchema } from "../../schemas/place";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { PLACE_CATEGORIES } from "../../shared/placeCategories";
import * as cell from "./cells";
import {
  MATCHED,
  type Ctx,
  dayRange,
  definedOnly,
  errorRow,
  isPending,
  keepDespiteError,
  labelForms,
  norm,
  pendingId,
  registerParent,
} from "./context";
import { pruneMissing } from "./prune";
import { resolveParent } from "./references";
import {
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell } from "./values";

const COORD_DECIMALS = 4;
const sameCoord = (a: number | null, b: number | undefined): boolean =>
  a !== null && b !== undefined && a.toFixed(COORD_DECIMALS) === b.toFixed(COORD_DECIMALS);

async function matchPlace(
  ctx: Ctx,
  f: { name?: string; lat?: number; lon?: number; city?: string }
): Promise<string | null> {
  if (!f.name) return null;
  const candidates = await prisma.place.findMany({
    where: {
      userId: ctx.userId,
      name: { equals: f.name, mode: "insensitive" },
      id: { notIn: [...ctx.claimed] },
    },
    select: { id: true, lat: true, lon: true, city: true },
    orderBy: { createdAt: "asc" },
  });
  const hit = candidates.find((c) =>
    f.lat !== undefined && f.lon !== undefined
      ? sameCoord(c.lat, f.lat) && sameCoord(c.lon, f.lon)
      : norm(c.city) === norm(f.city)
  );
  return hit?.id ?? null;
}

export async function importPlaces(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  /** Ids the file accounted for. Everything else is a deletion candidate in
   *  `replace` mode — including rows the file merely FAILED on. */
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    // +2: one for 1-based rows, one for the header. Matches what Excel shows.
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);

    const lat = cell.num(raw.lat);
    const lon = cell.num(raw.lon);
    if ((lat !== undefined && Number.isNaN(lat)) || (lon !== undefined && Number.isNaN(lon))) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_coordinates"));
      continue;
    }

    const dropped: DroppedValue[] = [];
    const fields = {
      name: cell.text(raw.name),
      category: enumCell(raw.category, PLACE_CATEGORIES, "category", dropped),
      lat,
      lon,
      address: cell.text(raw.address),
      city: cell.text(raw.city),
      country: cell.text(raw.country),
      notes: cell.text(raw.notes),
      visited: cell.bool(raw.visited),
    };
    const labels = labelForms(fields.name, fields.city);

    // Scoped by userId — this is the ownership check, not a convenience. A
    // foreign id misses here and the row is treated as new.
    const owned = fileId
      ? await prisma.place.findFirst({
          where: { id: fileId, userId: ctx.userId },
          select: { id: true },
        })
      : null;
    const targetId = owned?.id ?? (await matchPlace(ctx, fields));

    if (targetId) {
      ctx.claimed.add(targetId);
      seen.add(targetId);
      registerParent(ctx, "place", { fileId, id: targetId, labels });
      const message = owned ? undefined : MATCHED;
      // "add" only ever creates. A row naming an existing record is reported
      // as skipped rather than refused: the file is fine, the mode simply
      // says not to touch what is already there.
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists" });
        continue;
      }
      const stored = await prisma.place.findUniqueOrThrow({ where: { id: targetId } });
      const data: Record<string, unknown> = changedOnly(definedOnly(fields), stored);
      // The export writes the country as the reader's name for the stored
      // code ("Italien" for IT) — the same country, not an edit.
      if (data.country && resolveCountryCode(String(data.country)) === stored.isoCountryCode) {
        delete data.country;
      }
      if (data.country) data.isoCountryCode = resolveCountryCode(String(data.country));
      const extra = { dropped: droppedOrNone(dropped) };
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message, ...extra });
        continue;
      }
      if (!ctx.dryRun) await prisma.place.update({ where: { id: targetId }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: targetId, label, message, ...extra });
      continue;
    }

    // New place. Validated by the SAME schema the API uses, so the importer
    // cannot become a back door around the rules the form obeys.
    const parsed = createPlaceSchema.safeParse({
      name: fields.name,
      category: fields.category ?? "other",
      lat: fields.lat,
      lon: fields.lon,
      address: fields.address ?? null,
      city: fields.city ?? null,
      country: fields.country ?? null,
      notes: fields.notes ?? null,
      visited: fields.visited ?? false,
    });
    if (!parsed.success) {
      out.push(errorRow(rowNo, label, parsed.error.issues[0]?.message ?? "invalid_row"));
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await prisma.place.create({
        data: {
          userId: ctx.userId,
          ...parsed.data,
          isoCountryCode: resolveCountryCode(parsed.data.country ?? null),
          dataSource: "xlsx",
        },
        select: { id: true },
      });
      newId = created.id;
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    registerParent(ctx, "place", { fileId, id: newId ?? pendingId("places", rowNo), labels });
    out.push({ row: rowNo, action: "create", id: newId, label, dropped: droppedOrNone(dropped) });
  }

  const deleted = await pruneMissing("place", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ----------------------------------------------------------- place visits

/**
 * Visits are a CHILD table: a visit only means something under one place, and
 * that place has to be the caller's — otherwise a spreadsheet could attach a
 * visit to a stranger's place and read back a date from it. The parent is
 * resolved through `resolveParent`, which never accepts a foreign id.
 *
 * Left out on purpose: `orderIdx`. It is a tie-break the UI maintains by drag
 * order, and letting a sheet set it invites two visits claiming index 0.
 */
export async function importPlaceVisits(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const fileId = cell.text(raw.id);
    const label = cell.text(raw.placeId) ?? `#${rowNo}`;

    const visitedAt = cell.isoDate(raw.visitedAt);
    if (visitedAt === null) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }
    const rating = cell.int(raw.rating);
    if (rating !== undefined && (Number.isNaN(rating) || rating < 1 || rating > 5)) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_rating"));
      continue;
    }

    const fields = {
      visitedAt: visitedAt ? new Date(visitedAt) : undefined,
      rating,
      notes: cell.text(raw.notes),
    };

    const owned = fileId
      ? await prisma.placeVisit.findFirst({
          where: { id: fileId, userId: ctx.userId },
          select: { id: true },
        })
      : null;

    let targetId = owned?.id ?? null;
    let placeId: string | null = null;
    if (!targetId) {
      const parent = await resolveParent("place", raw.placeId, ctx);
      if ("error" in parent) {
        const code = parent.error === "place_missing" ? "visit_needs_place" : parent.error;
        out.push(errorRow(rowNo, label, code));
        continue;
      }
      placeId = parent.id;
      if (!isPending(placeId)) {
        const hit = await prisma.placeVisit.findFirst({
          where: {
            userId: ctx.userId,
            placeId,
            visitedAt: dayRange(visitedAt),
            id: { notIn: [...ctx.claimed] },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        targetId = hit?.id ?? null;
      }
    }

    if (targetId) {
      ctx.claimed.add(targetId);
      seen.add(targetId);
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists" });
        continue;
      }
      const stored = await prisma.placeVisit.findUniqueOrThrow({ where: { id: targetId } });
      const data = changedOnly(definedOnly(fields), stored);
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message });
        continue;
      }
      if (!ctx.dryRun) await prisma.placeVisit.update({ where: { id: targetId }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: targetId, label, message });
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun && placeId) {
      const created = await prisma.placeVisit.create({
        data: {
          userId: ctx.userId,
          placeId,
          visitedAt: visitedAt ? new Date(visitedAt) : null,
          rating: rating ?? null,
          notes: fields.notes ?? null,
        },
        select: { id: true },
      });
      newId = created.id;
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  const deleted = await pruneMissing("placeVisit", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
