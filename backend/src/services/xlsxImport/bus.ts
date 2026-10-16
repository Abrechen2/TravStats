/**
 * Bus rides from a spreadsheet (forgejo#180) — the shared terminal-ride sheet
 * rules (`terminalRides.ts`, which ferry uses too) with bus's own columns:
 * operator, line and ride kind. An unknown ride kind is left empty and
 * reported, never a reason to refuse the row.
 *
 * Bus's own derivation: a terminal that did not move leaves the frozen road
 * line AND its routed length alone; an import never calls a routing provider,
 * so a moved terminal drops the line, and "route all" in the logbook fetches
 * it again.
 */

import { prisma } from "../../db";
import { Prisma, type BusJourney } from "../../prisma";
import { BUS_RIDE_KINDS, BUS_STATUSES } from "../../schemas/bus";
import { mergeBusJourney } from "../bus/busJourneyWrite";
import { withRoutedDistance } from "../bus/busRouting";
import { linkRowsFor, resolveCompanions } from "../companionService";
import type { TerminalRideInput } from "../rides/terminalRideWrite";
import * as cell from "./cells";
import { type Ctx, definedOnly } from "./context";
import { importTerminalRides, type TerminalRideSheet } from "./terminalRides";
import type { DroppedValue, IncomingSheet, SheetOutcome } from "./types";
import { enumCell } from "./values";

/** The plain columns — no derivation, written as the sheet says. */
function plainFields(raw: Record<string, string>, dropped: DroppedValue[]) {
  return definedOnly({
    operator: cell.text(raw.operator),
    lineName: cell.text(raw.lineName),
    rideKind: enumCell(raw.rideKind, BUS_RIDE_KINDS, "rideKind", dropped),
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

/** The merged columns; a moved terminal drops the frozen road line, which no longer joins them. */
function derivedColumns(
  stored: BusJourney | null,
  input: TerminalRideInput
): Prisma.BusJourneyUncheckedUpdateInput {
  const state = mergeBusJourney(stored, input);
  const moved = input.departureStation !== undefined || input.arrivalStation !== undefined;
  if (!stored) return state;
  if (!moved) return withRoutedDistance(state, stored, { kind: "unchanged" });
  return { ...state, geometry: Prisma.DbNull, geometrySource: "straight" };
}

async function writeRide(
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
      ? (await tx.busJourney.update({ where: { id: targetId }, data: payload })).id
      : (
          await tx.busJourney.create({
            data: { ...payload, userId: ctx.userId } as Prisma.BusJourneyUncheckedCreateInput,
          })
        ).id;
    if (companions) {
      await tx.busJourneyCompanion.deleteMany({ where: { busJourneyId: id } });
      if (companions.length > 0) {
        await tx.busJourneyCompanion.createMany({
          data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
            ...row,
            busJourneyId: id,
          })),
          skipDuplicates: true,
        });
      }
    }
    return id;
  });
}

const BUS_SHEET: TerminalRideSheet<BusJourney> = {
  prune: "busJourney",
  statuses: BUS_STATUSES,
  codes: { needsCoordinates: "bus_needs_coordinates", needsRoute: "bus_needs_route" },
  plainFields,
  findOwned: (id, userId) => prisma.busJourney.findFirst({ where: { id, userId } }),
  findByNaturalKey: (where) => prisma.busJourney.findMany({ where, orderBy: { createdAt: "asc" } }),
  derivedColumns,
  write: writeRide,
};

export function importBus(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  return importTerminalRides(sheet, ctx, BUS_SHEET);
}
