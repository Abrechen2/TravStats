import { prisma } from "../db";
import logger from "../utils/logger";
import { lookupFlightWithHistorical } from "./flightLookup";
import { getAirportTimezone, toLocalDateString } from "../utils/timezone";

/**
 * One last question about a flight that landed without its actual times.
 *
 * ## Why this exists
 *
 * The live checks are scheduled around the timetable: departure −30 min,
 * arrival −60 min, arrival +30 min. For a flight that lands on the day it
 * departed, all three fall on the same date and the free Aviationstack plan
 * serves them. For an OVERNIGHT flight the two arrival checks fall on the day
 * after, where that plan refuses the date filter — so the only two checks that
 * can capture an actual arrival are refused, every time, for every long-haul
 * leg. Six hours after arrival the status sweep flips the flight to `flown`,
 * and `checkAndUpdate` only ever looks at `scheduled` ones. The door closed
 * and nothing opened it again.
 *
 * Measured on a real account on 2026-09-03: two long-haul legs with no actual
 * times at all, and the short hop between them with its own — the whole
 * difference being which calendar day their checks landed on.
 *
 * ## Why it asks AeroDataBox and not the live cascade
 *
 * `lookupFlightWithHistorical` is the path that reaches AeroDataBox, the one
 * provider that serves a past date. It is also where the overnight
 * date-role filter now lives, so the answer is about the right service day.
 *
 * ## Exactly once, without a new column
 *
 * The status sweep leaves `nextApiCheckAt` SET on a flight it flips to `flown`
 * without an actual arrival, and clears it on one that has it. On a `flown`
 * flight that field therefore means "a last attempt is outstanding", and this
 * service clears it whether the attempt succeeds or not. A flight can pass
 * through here once. Nothing retries, nothing accumulates, and no migration
 * was needed to say so.
 *
 * That also bounds the provider spend by construction: only flights that
 * landed since the last sweep are ever marked, so the daily volume is the
 * number of flights the user actually took, not the size of their logbook.
 */

/** Flights touched per run. A generous ceiling — see the note above on volume. */
const MAX_PER_RUN = 10;

export interface FinalArrivalSweepSummary {
  /** Flights whose outstanding last attempt was made. */
  attempted: number;
  /** Flights where the provider filled at least one field. */
  filled: number;
}

/**
 * The local calendar day the flight departed on, which is what the provider
 * indexes by. Falls back to the UTC day when the airport timezone is unknown —
 * the same fallback the live path takes.
 */
async function departureLocalDay(
  departureTime: Date,
  depIata: string | null,
  depIcao: string | null
): Promise<string> {
  const code = depIata ?? depIcao;
  const tz = code ? await getAirportTimezone(code) : null;
  return toLocalDateString(departureTime, tz ?? "UTC");
}

export async function runFinalArrivalSweep(
  now: Date = new Date()
): Promise<FinalArrivalSweepSummary> {
  const summary: FinalArrivalSweepSummary = { attempted: 0, filled: 0 };

  const due = await prisma.flight.findMany({
    where: {
      status: "flown",
      actualArrival: null,
      nextApiCheckAt: { not: null, lte: now },
      flightNumber: { not: null },
      departureTime: { not: null },
    },
    select: {
      id: true,
      userId: true,
      flightNumber: true,
      departureTime: true,
      depIata: true,
      depIcao: true,
      aircraft: true,
      actualDeparture: true,
    },
    orderBy: { departureTime: "desc" },
    take: MAX_PER_RUN,
  });

  for (const flight of due) {
    summary.attempted++;
    // Cleared FIRST, and deliberately: a provider error must not leave the
    // flight due for ever, quietly asking again on every sweep. One attempt
    // is what was promised, and one attempt is what a failure spends.
    await prisma.flight.update({
      where: { id: flight.id },
      data: { nextApiCheckAt: null },
    });

    try {
      const date = await departureLocalDay(
        flight.departureTime as Date,
        flight.depIata,
        flight.depIcao
      );
      const { flights: matches } = await lookupFlightWithHistorical(
        flight.flightNumber as string,
        flight.departureTime as Date,
        flight.userId,
        flight.depIata ?? flight.depIcao ?? undefined
      );
      const match = matches[0];
      if (!match) {
        logger.info(
          {
            flightId: flight.id,
            flightNumber: flight.flightNumber,
            date,
            operation: "final_arrival_no_data",
          },
          `No provider data for ${flight.flightNumber} on its last attempt`
        );
        continue;
      }

      // Fill, never overwrite — the same rule the bulk refresh follows. A
      // stored actual time came from a live check or from the user, and a
      // later provider answer is not better evidence about a departure that
      // has already happened.
      const patch: {
        actualArrival?: Date;
        actualDeparture?: Date;
        aircraft?: string;
      } = {};
      if (match.arrival?.actualTime) patch.actualArrival = new Date(match.arrival.actualTime);
      if (!flight.actualDeparture && match.departure?.actualTime) {
        patch.actualDeparture = new Date(match.departure.actualTime);
      }
      if (!flight.aircraft && match.aircraft) patch.aircraft = match.aircraft;

      if (Object.keys(patch).length === 0) continue;

      await prisma.flight.update({ where: { id: flight.id }, data: patch });
      summary.filled++;
      logger.info(
        {
          flightId: flight.id,
          flightNumber: flight.flightNumber,
          fields: Object.keys(patch),
          operation: "final_arrival_filled",
        },
        `Last attempt filled ${Object.keys(patch).join(", ")} for ${flight.flightNumber}`
      );
    } catch (error) {
      logger.warn(
        {
          flightId: flight.id,
          flightNumber: flight.flightNumber,
          err: error instanceof Error ? error.message : String(error),
          operation: "final_arrival_failed",
        },
        `Last attempt failed for ${flight.flightNumber}`
      );
    }
  }

  return summary;
}
