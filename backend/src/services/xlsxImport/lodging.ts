/**
 * Lodgings and their stays.
 *
 * Both are created through the app's own validation and writers:
 * `createLodgingSchema` + `createLodgingRecord` for the house, and
 * `createStaySchema` + `createStayRecord` (update: `updateStaySchema` +
 * `updateStayRecord`) for the stay — the same code the forms run, so status,
 * overall rating, total price and the FX snapshot are derived exactly as they
 * are for a stay typed in by hand. No inline geocoding (same rule as the CSV
 * import): a house without coordinates is filled by the background pass.
 *
 * Natural keys: lodging = name + city; stay = lodging + check-in day +
 * check-out day. The chain is looked up by name and never created.
 */

import { prisma } from "../../db";
import { createLodgingSchema, createStaySchema, updateStaySchema } from "../../schemas/lodging";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { createLodgingRecord } from "../lodging/createLodging";
import { createStayRecord, updateStayRecord } from "../lodging/stayWrites";
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
  pendingId,
  registerParent,
} from "./context";
import { pruneMissing } from "./prune";
import { findChainId, resolveParent } from "./references";
import { summarise, type IncomingSheet, type RowOutcome, type SheetOutcome } from "./types";
import logger from "../../utils/logger";

async function matchLodging(
  ctx: Ctx,
  key: { name?: string; city?: string }
): Promise<string | null> {
  if (!key.name) return null;
  const hit = await prisma.lodging.findFirst({
    where: {
      userId: ctx.userId,
      name: { equals: key.name, mode: "insensitive" },
      city: key.city ? { equals: key.city, mode: "insensitive" } : null,
      id: { notIn: [...ctx.claimed] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return hit?.id ?? null;
}

export async function importLodging(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);

    const lat = cell.num(raw.lat);
    const lon = cell.num(raw.lon);
    const stars = cell.int(raw.stars);
    if (
      (lat !== undefined && Number.isNaN(lat)) ||
      (lon !== undefined && Number.isNaN(lon)) ||
      (stars !== undefined && Number.isNaN(stars))
    ) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }

    const country = cell.text(raw.country);
    const fields = {
      name: cell.text(raw.name),
      address: cell.text(raw.address),
      city: cell.text(raw.city),
      country,
      lat,
      lon,
      stars,
      notes: cell.text(raw.notes),
      visited: cell.bool(raw.visited),
      amenities: cell.list(raw.amenities),
    };
    const labels = labelForms(fields.name, fields.city);

    // Scoped by userId: a foreign id misses and the row is new to this account.
    const owned = fileId
      ? await prisma.lodging.findFirst({
          where: { id: fileId, userId: ctx.userId },
          select: { id: true },
        })
      : null;
    const targetId = owned?.id ?? (await matchLodging(ctx, fields));

    if (targetId) {
      ctx.claimed.add(targetId);
      seen.add(targetId);
      registerParent(ctx, "lodging", { fileId, id: targetId, labels });
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists" });
        continue;
      }
      const data = definedOnly({
        ...fields,
        isoCountryCode: country ? (resolveCountryCode(country) ?? undefined) : undefined,
      });
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label });
        continue;
      }
      if (!ctx.dryRun) await prisma.lodging.update({ where: { id: targetId }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: targetId, label, message });
      continue;
    }

    const chainName = cell.text(raw.chain);
    const chainId = await findChainId(chainName);
    const notes = chainName && !chainId ? ["chain_not_found"] : undefined;
    const type = cell.text(raw.type);
    const parsed = createLodgingSchema.safeParse({
      ...(type ? { type } : {}),
      name: fields.name,
      chainId: chainId ?? null,
      address: fields.address ?? null,
      city: fields.city ?? null,
      country: fields.country ?? null,
      lat: fields.lat ?? null,
      lon: fields.lon ?? null,
      stars: fields.stars ?? null,
      amenities: fields.amenities ?? [],
      notes: fields.notes ?? null,
    });
    if (!parsed.success) {
      out.push(errorRow(rowNo, label, "invalid_row"));
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await createLodgingRecord(
        ctx.userId,
        { ...parsed.data, visited: fields.visited ?? true },
        { dataSource: "xlsx" }
      );
      newId = created.id;
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    registerParent(ctx, "lodging", { fileId, id: newId ?? pendingId("lodging", rowNo), labels });
    out.push({ row: rowNo, action: "create", id: newId, label, notes });
  }

  const deleted = await pruneMissing("lodging", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ------------------------------------------------------------------ stays

function stayFields(raw: Record<string, string>) {
  const checkIn = cell.isoDate(raw.checkIn);
  const checkOut = cell.isoDate(raw.checkOut);
  const pricePerNight = cell.num(raw.pricePerNight);
  const totalPrice = cell.num(raw.totalPrice);
  return {
    checkIn,
    checkOut,
    bad:
      checkIn === null ||
      checkOut === null ||
      (pricePerNight !== undefined && Number.isNaN(pricePerNight)) ||
      (totalPrice !== undefined && Number.isNaN(totalPrice)),
    // `nights` is locked in the sheet and derived by the server — never read.
    values: {
      checkIn: checkIn ?? undefined,
      checkOut: checkOut ?? undefined,
      status: cell.text(raw.status),
      roomNumber: cell.text(raw.roomNumber),
      roomCategory: cell.text(raw.roomCategory),
      board: cell.text(raw.board),
      pricePerNight,
      totalPrice,
      currency: cell.text(raw.currency),
    },
  };
}

/** A write the shared stay writer refused (e.g. a time on an undated stay). */
function refusedWrite(err: unknown, rowNo: number, label: string, ctx: Ctx): RowOutcome {
  logger.warn(
    {
      operation: "xlsx_import_stay_refused",
      userId: ctx.userId,
      row: rowNo,
      message: err instanceof Error ? err.message : String(err),
    },
    "Spreadsheet import: stay write refused"
  );
  return errorRow(rowNo, label, "invalid_row");
}

export async function importLodgingStays(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const fileId = cell.text(raw.id);
    const label = cell.text(raw.lodgingId) ?? `#${rowNo}`;

    const f = stayFields(raw);
    if (f.bad) {
      out.push(
        errorRow(
          rowNo,
          label,
          f.checkIn === null || f.checkOut === null ? "invalid_date" : "invalid_number"
        )
      );
      continue;
    }

    const owned = fileId
      ? await prisma.lodgingStay.findFirst({ where: { id: fileId, userId: ctx.userId } })
      : null;

    let target = owned;
    let lodgingId: string | null = null;
    if (!target) {
      const parent = await resolveParent("lodging", raw.lodgingId, ctx);
      if ("error" in parent) {
        const code = parent.error === "lodging_missing" ? "stay_needs_lodging" : parent.error;
        out.push(errorRow(rowNo, label, code));
        continue;
      }
      lodgingId = parent.id;
      if (!isPending(lodgingId)) {
        target = await prisma.lodgingStay.findFirst({
          where: {
            userId: ctx.userId,
            lodgingId,
            checkIn: dayRange(f.checkIn),
            checkOut: dayRange(f.checkOut),
            id: { notIn: [...ctx.claimed] },
          },
          orderBy: { createdAt: "asc" },
        });
      }
    }

    if (target) {
      ctx.claimed.add(target.id);
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: target.id, label, message: "exists" });
        continue;
      }
      const values = definedOnly(f.values);
      if (Object.keys(values).length === 0) {
        out.push({ row: rowNo, action: "skip", id: target.id, label });
        continue;
      }
      const parsed = updateStaySchema.safeParse(values);
      if (!parsed.success) {
        out.push(errorRow(rowNo, label, "invalid_row"));
        continue;
      }
      if (!ctx.dryRun) {
        try {
          await updateStayRecord(ctx.userId, target, parsed.data);
        } catch (err) {
          out.push(refusedWrite(err, rowNo, label, ctx));
          continue;
        }
        ctx.wrote = true;
      }
      out.push({ row: rowNo, action: "update", id: target.id, label, message });
      continue;
    }

    const parsed = createStaySchema.safeParse(definedOnly(f.values));
    if (!parsed.success) {
      out.push(errorRow(rowNo, label, "invalid_row"));
      continue;
    }
    let newId: string | null = null;
    if (!ctx.dryRun && lodgingId) {
      try {
        const created = await createStayRecord(ctx.userId, lodgingId, parsed.data, {
          dataSource: "xlsx",
        });
        newId = created.id;
      } catch (err) {
        out.push(refusedWrite(err, rowNo, label, ctx));
        continue;
      }
      ctx.claimed.add(newId);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  return summarise(sheet.key, out, 0);
}
