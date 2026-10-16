/**
 * Ferry crossings from a spreadsheet — the round trip of the ferry sheet the
 * export writes (`frontend/src/lib/xlsx/ferrySheet.ts`), on the terminal-ride
 * sheet rules bus uses (`terminalRides.ts`), with ferry's own columns: vessel,
 * vehicle and cabin.
 *
 * Ferry's own derivation: a crossing has no routed line, so a moved port drops
 * a hand-drawn line, which no longer joins the two ports. The link to a
 * roadtrip leg is not a sheet column and is never touched here.
 */

import { prisma } from "../../db";
import { Prisma, type FerryJourney } from "../../prisma";
import { FERRY_STATUSES } from "../../schemas/ferry";
import { mergeFerryJourney } from "../ferry/ferryJourneyWrite";
import { linkRowsFor, resolveCompanions } from "../companionService";
import type { TerminalRideInput } from "../rides/terminalRideWrite";
import * as cell from "./cells";
import { type Ctx, definedOnly } from "./context";
import { importTerminalRides, type TerminalRideSheet } from "./terminalRides";
import type { DroppedValue, IncomingSheet, SheetOutcome } from "./types";

/** The plain columns — no derivation, written as the sheet says. */
function plainFields(raw: Record<string, string>, dropped: DroppedValue[]) {
  // An unreadable head count is left out and reported, never written as NaN.
  let passengerCount = cell.int(raw.passengerCount);
  if (passengerCount !== undefined && (Number.isNaN(passengerCount) || passengerCount < 1)) {
    dropped.push({ field: "passengerCount", value: raw.passengerCount });
    passengerCount = undefined;
  }
  return definedOnly({
    operator: cell.text(raw.operator),
    vesselName: cell.text(raw.vesselName),
    vehicleType: cell.text(raw.vehicleType),
    vehicleRegistration: cell.text(raw.vehicleRegistration),
    passengerCount,
    cabinType: cell.text(raw.cabinType),
    ticketReference: cell.text(raw.ticketReference),
    fareClass: cell.text(raw.fareClass),
    seat: cell.text(raw.seat),
    bookingReference: cell.text(raw.bookingReference),
    delayMinutes: cell.int(raw.delayMinutes),
    price: cell.num(raw.price),
    currency: cell.text(raw.currency)?.toUpperCase(),
    notes: cell.text(raw.notes),
    tags: cell.list(raw.tags),
  });
}

function derivedColumns(
  stored: FerryJourney | null,
  input: TerminalRideInput
): Prisma.FerryJourneyUncheckedUpdateInput {
  const state = mergeFerryJourney(stored, input);
  const moved = input.departureStation !== undefined || input.arrivalStation !== undefined;
  if (!stored || !moved) return state;
  return { ...state, geometry: Prisma.DbNull, geometrySource: "straight" };
}

async function writeCrossing(
  ctx: Ctx,
  targetId: string | null,
  data: Record<string, unknown>,
  companionNames: string[] | undefined
): Promise<string> {
  const companions =
    companionNames === undefined ? undefined : await resolveCompanions(ctx.userId, companionNames);
  return prisma.$transaction(async (tx) => {
    const payload = {
      ...data,
      ...(companions && { companions: companions.map((c) => c.displayName) }),
    };
    const id = targetId
      ? (await tx.ferryJourney.update({ where: { id: targetId }, data: payload })).id
      : (
          await tx.ferryJourney.create({
            data: { ...payload, userId: ctx.userId } as Prisma.FerryJourneyUncheckedCreateInput,
          })
        ).id;
    if (companions) {
      await tx.ferryJourneyCompanion.deleteMany({ where: { ferryJourneyId: id } });
      if (companions.length > 0) {
        await tx.ferryJourneyCompanion.createMany({
          data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
            ...row,
            ferryJourneyId: id,
          })),
          skipDuplicates: true,
        });
      }
    }
    return id;
  });
}

const FERRY_SHEET: TerminalRideSheet<FerryJourney> = {
  prune: "ferryJourney",
  statuses: FERRY_STATUSES,
  codes: { needsCoordinates: "ferry_needs_coordinates", needsRoute: "ferry_needs_route" },
  plainFields,
  findOwned: (id, userId) => prisma.ferryJourney.findFirst({ where: { id, userId } }),
  findByNaturalKey: (where) =>
    prisma.ferryJourney.findMany({ where, orderBy: { createdAt: "asc" } }),
  derivedColumns,
  write: writeCrossing,
};

export function importFerry(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  return importTerminalRides(sheet, ctx, FERRY_SHEET);
}
