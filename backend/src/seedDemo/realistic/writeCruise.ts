import { prisma } from "../../db";
import { recomputeLegsForCruise } from "../../services/cruiseDistance/cruiseLegService";
import { linkRowsFor } from "../../services/companionService";
import { deriveCruiseStatus } from "../../shared/statusDerivation";
import { stopTimesForDay } from "../cruiseTiming";
import { seedPriceFxColumns } from "../stayFx";
import type { CruiseSpec } from "./data/types";
import { companionIds, type SeedContext } from "./context";
import { addDays, localInstant } from "./time";

/**
 * One cruise and its itinerary. Every stop is in exactly one of the three
 * states the stop invariant allows, `dayNumber` is the day of the cruise, and
 * the legs are measured by the same marnet service a saved cruise gets — the
 * sea route the map draws is computed from the ports at request time.
 */
export async function writeCruise(
  ctx: SeedContext,
  tripId: string | null,
  day: Date,
  spec: CruiseSpec,
  names: readonly string[]
): Promise<string> {
  const ports = spec.stops.flatMap((s) => {
    if (!("locode" in s)) return [];
    const port = ctx.portByLocode.get(s.locode);
    if (!port) throw new Error(`Demo seed: port ${s.locode} was not loaded`);
    return [port];
  });
  const first = ports[0];
  const last = ports[ports.length - 1];
  const lastDay = spec.stops.length - 1;
  const startDate = localInstant(addDays(day, spec.d), spec.embark, first);
  const endDate = localInstant(addDays(day, spec.d + lastDay), spec.disembark, last);

  const catalogueShip =
    "catalogue" in spec.ship ? ctx.shipIdByName.get(spec.ship.catalogue) : undefined;
  const cruise = await prisma.cruise.create({
    data: {
      userId: ctx.userId,
      tripId,
      shipId: catalogueShip?.id ?? null,
      // A ship the catalogue does not carry is typed in by name — the same
      // row the cruise form writes for one.
      shipNameOverride: "override" in spec.ship ? spec.ship.override : null,
      cruiseLine: catalogueShip?.cruiseLine ?? ("line" in spec.ship ? spec.ship.line : null),
      departurePortId: first.id,
      arrivalPortId: last.id,
      startDate,
      endDate,
      status: deriveCruiseStatus({ startDate, endDate, current: "scheduled", now: ctx.now }),
      cabinNumber: spec.cabin,
      cabinType: spec.cabinType,
      deck: spec.deck,
      bookingReference: spec.bookingReference,
      price: spec.price,
      currency: "EUR",
      ...seedPriceFxColumns(spec.price, "EUR", startDate, ctx.baseCurrency),
      notes: spec.notes ?? null,
      companions: [...names],
      dataSource: "manual",
    },
  });

  const ids = companionIds(ctx, names);
  if (ids.length > 0) {
    await prisma.cruiseCompanion.createMany({
      data: linkRowsFor(ids).map((l) => ({ cruiseId: cruise.id, ...l })),
      skipDuplicates: true,
    });
  }

  for (const [i, stop] of spec.stops.entries()) {
    const dayNumber = i + 1;
    if ("atSea" in stop) {
      await prisma.cruiseStop.create({
        data: {
          cruiseId: cruise.id,
          dayNumber,
          isAtSea: true,
          portId: null,
          unresolvedPortName: null,
        },
      });
      continue;
    }
    const times = stopTimesForDay(startDate, endDate, i);
    await prisma.cruiseStop.create({
      data: {
        cruiseId: cruise.id,
        dayNumber,
        isAtSea: false,
        portId: "locode" in stop ? (ctx.portByLocode.get(stop.locode)?.id ?? null) : null,
        unresolvedPortName: "unresolved" in stop ? stop.unresolved : null,
        arrivalTime: times.arrivalTime,
        departureTime: times.departureTime,
        excursionNote: stop.note ?? null,
      },
    });
  }

  await recomputeLegsForCruise(cruise.id);
  return cruise.id;
}
