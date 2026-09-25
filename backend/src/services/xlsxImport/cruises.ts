/**
 * Cruises and their stops.
 *
 * A new cruise goes through `createCruiseSchema` and `createCruiseRecord` —
 * the form's own validation and writer — so status derivation, companions,
 * the FX snapshot and the trip status are the same whichever way it arrived.
 * Its stops come from their own sheet afterwards (a cruise has as many stops
 * as it has, a row cannot hold them), and every cruise whose stops changed
 * gets its legs recomputed once at the end of the run.
 *
 * The sheet carries NAMES for the ship and the ports. A name the catalogue
 * knows becomes the reference; an unknown ship stays as the typed name
 * (`shipNameOverride`), an unknown stop port as an UNRESOLVED stop (the third
 * state of the stop invariant) — never lost, resolvable later in the app. An
 * unknown departure/arrival port has no such state and is left empty with a
 * `port_not_found` note.
 *
 * Natural keys: cruise = start day + line + route name; stop = cruise + day
 * number + what the stop is (port, unresolved name, or sea day).
 */

import { prisma } from "../../db";
import { createCruiseSchema, cruiseStopSchema } from "../../schemas/cruise";
import { createCruiseRecord } from "../cruise/createCruise";
import { cruiseFxColumnsIfChanged, findCruiseForFxMerge } from "./fxSnapshot";
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
import { cruiseLabelBase, findPortId, findShipId, resolveParent, resolveTrip } from "./references";
import { summarise, type IncomingSheet, type RowOutcome, type SheetOutcome } from "./types";

/** Statuses the write schema accepts. `in_progress` is derived and stored,
 *  never written — an exported one is dropped and re-derived from the dates. */
const WRITABLE_STATUSES = new Set(["scheduled", "flown", "cancelled", "historical"]);

async function matchCruise(
  ctx: Ctx,
  key: { startDate?: string; cruiseLine?: string; routeName?: string }
): Promise<string | null> {
  if (!key.startDate) return null;
  const candidates = await prisma.cruise.findMany({
    where: {
      userId: ctx.userId,
      startDate: dayRange(key.startDate) ?? undefined,
      id: { notIn: [...ctx.claimed] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, cruiseLine: true, routeName: true },
  });
  const hit = candidates.find(
    (c) => norm(c.cruiseLine) === norm(key.cruiseLine) && norm(c.routeName) === norm(key.routeName)
  );
  return hit?.id ?? null;
}

async function createCruiseFromRow(
  raw: Record<string, string>,
  ctx: Ctx,
  base: { startDate?: string; endDate?: string; price?: number; currency?: string },
  tripId: string | undefined,
  notes: string[]
): Promise<{ id: string | null } | { error: string }> {
  const shipName = cell.text(raw.ship);
  const shipId = await findShipId(shipName);
  const depName = cell.text(raw.departurePort);
  const arrName = cell.text(raw.arrivalPort);
  const departurePortId = await findPortId(depName);
  const arrivalPortId = await findPortId(arrName);
  if ((depName && !departurePortId) || (arrName && !arrivalPortId)) notes.push("port_not_found");
  const status = cell.text(raw.status);

  const parsed = createCruiseSchema.safeParse({
    cruiseLine: cell.text(raw.cruiseLine) ?? null,
    shipId: shipId ?? null,
    shipNameOverride: shipId ? null : (shipName ?? null),
    routeName: cell.text(raw.routeName) ?? null,
    startDate: base.startDate ?? null,
    endDate: base.endDate ?? null,
    ...(status && WRITABLE_STATUSES.has(status) ? { status } : {}),
    departurePortId,
    arrivalPortId,
    cabinNumber: cell.text(raw.cabinNumber) ?? null,
    cabinType: cell.text(raw.cabinType) ?? null,
    deck: cell.int(raw.deck) ?? null,
    bookingReference: cell.text(raw.bookingReference) ?? null,
    price: base.price ?? null,
    ...(base.currency ? { currency: base.currency } : {}),
    notes: cell.text(raw.notes) ?? null,
    tags: cell.list(raw.tags) ?? [],
    companions: cell.list(raw.companions) ?? [],
    tripId: tripId ?? null,
  });
  if (!parsed.success) return { error: "invalid_row" };
  if (ctx.dryRun) return { id: null };

  const { importBatchId: _batch, ...data } = parsed.data;
  const created = await createCruiseRecord(ctx.userId, data, { dataSource: "xlsx" });
  return { id: created.id };
}

export async function importCruises(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.routeName) ?? cell.text(raw.ship) ?? `#${rowNo}`;
    const fileId = cell.text(raw.id);

    const startDate = cell.isoDate(raw.startDate);
    const endDate = cell.isoDate(raw.endDate);
    if (startDate === null || endDate === null) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }
    const price = cell.num(raw.price);
    const deck = cell.int(raw.deck);
    if (
      (price !== undefined && Number.isNaN(price)) ||
      (deck !== undefined && Number.isNaN(deck))
    ) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }
    const currency = cell.text(raw.currency);
    const trip = await resolveTrip(raw.tripId, ctx.userId);
    const notes: string[] = trip.note ? [trip.note] : [];
    const labels = labelForms(
      cruiseLabelBase({
        routeName: cell.text(raw.routeName),
        shipNameOverride: cell.text(raw.ship),
        cruiseLine: cell.text(raw.cruiseLine),
      }),
      startDate
    );

    // Scoped by userId: a foreign id misses and the row is new to this account.
    const owned = fileId ? await findCruiseForFxMerge(fileId, ctx.userId) : null;
    const targetId =
      owned?.id ??
      (await matchCruise(ctx, {
        startDate,
        cruiseLine: cell.text(raw.cruiseLine),
        routeName: cell.text(raw.routeName),
      }));

    if (targetId) {
      ctx.claimed.add(targetId);
      seen.add(targetId);
      registerParent(ctx, "cruise", { fileId, id: targetId, labels });
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists" });
        continue;
      }
      const startDateValue = startDate ? new Date(startDate) : undefined;
      const fields: Record<string, unknown> = {
        cruiseLine: cell.text(raw.cruiseLine),
        routeName: cell.text(raw.routeName),
        startDate: startDateValue,
        endDate: endDate ? new Date(endDate) : undefined,
        cabinNumber: cell.text(raw.cabinNumber),
        deck,
        bookingReference: cell.text(raw.bookingReference),
        price,
        currency,
        notes: cell.text(raw.notes),
        tags: cell.list(raw.tags),
        companions: cell.list(raw.companions),
        tripId: trip.tripId,
      };
      const existing = owned ?? (await findCruiseForFxMerge(targetId, ctx.userId));
      // FX snapshot (fix round 1, finding 3) — see `xlsxImport/fxSnapshot.ts`.
      if (existing) {
        Object.assign(
          fields,
          await cruiseFxColumnsIfChanged(
            ctx.userId,
            { price, currency, startDate: startDateValue },
            existing
          )
        );
      }
      const data = definedOnly(fields);
      const rowNotes = notes.length > 0 ? notes : undefined;
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, notes: rowNotes });
        continue;
      }
      if (!ctx.dryRun) await prisma.cruise.update({ where: { id: targetId }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: targetId, label, message, notes: rowNotes });
      continue;
    }

    const created = await createCruiseFromRow(
      raw,
      ctx,
      { startDate, endDate, price, currency },
      trip.tripId,
      notes
    );
    if ("error" in created) {
      out.push(errorRow(rowNo, label, created.error));
      continue;
    }
    if (created.id) {
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    registerParent(ctx, "cruise", {
      fileId,
      id: created.id ?? pendingId("cruises", rowNo),
      labels,
    });
    out.push({
      row: rowNo,
      action: "create",
      id: created.id,
      label,
      notes: notes.length > 0 ? notes : undefined,
    });
  }

  const deleted = await pruneMissing("cruise", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ----------------------------------------------------------------- stops

/** The stop's state from its cells, under the 3-state invariant. */
async function stopState(raw: Record<string, string>): Promise<{
  isAtSea: boolean;
  portId: number | null;
  unresolvedPortName: string | null;
}> {
  if (cell.bool(raw.isAtSea) === true) {
    return { isAtSea: true, portId: null, unresolvedPortName: null };
  }
  const name = cell.text(raw.port);
  const portId = await findPortId(name);
  return { isAtSea: false, portId, unresolvedPortName: portId ? null : (name ?? null) };
}

export async function importCruiseStops(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const fileId = cell.text(raw.id);
    const label = cell.text(raw.port) ?? cell.text(raw.cruiseId) ?? `#${rowNo}`;

    const dayNumber = cell.int(raw.dayNumber);
    const arrivalTime = cell.isoDateTime(raw.arrivalTime);
    const departureTime = cell.isoDateTime(raw.departureTime);
    if (arrivalTime === null || departureTime === null) {
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }
    const state = await stopState(raw);
    const parsed = cruiseStopSchema.safeParse({
      ...state,
      dayNumber,
      arrivalTime: arrivalTime ?? null,
      departureTime: departureTime ?? null,
      excursionNote: cell.text(raw.excursionNote),
    });
    if (!parsed.success) {
      out.push(errorRow(rowNo, label, "invalid_row"));
      continue;
    }
    const stop = {
      dayNumber: parsed.data.dayNumber,
      isAtSea: parsed.data.isAtSea,
      portId: parsed.data.portId ?? null,
      unresolvedPortName: parsed.data.unresolvedPortName ?? null,
      arrivalTime: parsed.data.arrivalTime ? new Date(parsed.data.arrivalTime) : null,
      departureTime: parsed.data.departureTime ? new Date(parsed.data.departureTime) : null,
      excursionNote: parsed.data.excursionNote ?? null,
    };

    // A stop has no userId of its own; ownership is its cruise's.
    const owned = fileId
      ? await prisma.cruiseStop.findFirst({
          where: { id: fileId, cruise: { userId: ctx.userId } },
          select: { id: true, cruiseId: true },
        })
      : null;

    let target = owned;
    let cruiseId = owned?.cruiseId ?? null;
    if (!target) {
      const parent = await resolveParent("cruise", raw.cruiseId, ctx);
      if ("error" in parent) {
        const code = parent.error === "cruise_missing" ? "stop_needs_cruise" : parent.error;
        out.push(errorRow(rowNo, label, code));
        continue;
      }
      cruiseId = parent.id;
      if (!isPending(cruiseId)) {
        target = await prisma.cruiseStop.findFirst({
          where: {
            cruiseId,
            dayNumber: stop.dayNumber,
            isAtSea: stop.isAtSea,
            portId: stop.portId,
            unresolvedPortName: stop.unresolvedPortName,
            id: { notIn: [...ctx.claimed] },
          },
          select: { id: true, cruiseId: true },
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
      if (!ctx.dryRun) {
        // What the stop IS (port / unresolved / sea day) is always written as
        // one triple, so the invariant cannot be half-updated; the optional
        // cells follow the usual rule — blank means "not mentioned".
        const optional = definedOnly({
          arrivalTime: arrivalTime ? stop.arrivalTime : undefined,
          departureTime: departureTime ? stop.departureTime : undefined,
          excursionNote: cell.text(raw.excursionNote),
        });
        await prisma.cruiseStop.update({
          where: { id: target.id },
          data: {
            dayNumber: stop.dayNumber,
            isAtSea: stop.isAtSea,
            portId: stop.portId,
            unresolvedPortName: stop.unresolvedPortName,
            ...optional,
          },
        });
        ctx.touchedCruises.add(target.cruiseId);
        ctx.wrote = true;
      }
      out.push({ row: rowNo, action: "update", id: target.id, label, message });
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun && cruiseId) {
      const created = await prisma.cruiseStop.create({
        data: { ...stop, cruiseId },
        select: { id: true },
      });
      newId = created.id;
      ctx.claimed.add(created.id);
      ctx.touchedCruises.add(cruiseId);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  return summarise(sheet.key, out, 0);
}
