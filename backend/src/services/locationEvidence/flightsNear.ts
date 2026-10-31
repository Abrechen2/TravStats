import { prisma } from "../../db";
import { RECORDER_ARM_MARGIN_MS } from "../flightDevice/flightWindow";
import { FLIGHT_WINDOW_SELECT } from "../tripRecording/bounds";

const HOUR_MS = 3_600_000;
/**
 * How far a stored flight end may lie from the instant it means: a legacy row
 * keeps the airport's wall clock as fake UTC (up to 14 h off), and the
 * recorder arms 30 minutes either side.
 */
export const FLIGHT_QUERY_MARGIN_MS = 15 * HOUR_MS + RECORDER_ARM_MARGIN_MS;
/** No scheduled flight is longer: a departure further back cannot reach the span. */
export const MAX_FLIGHT_SPAN_MS = 48 * HOUR_MS;

/**
 * The account's flights whose recorder window can touch `[fromMs, untilMs]`,
 * bounded in the database — a long flight history is never read whole.
 */
export function flightsNear(userId: string, fromMs: number, untilMs: number) {
  const lo = new Date(fromMs - FLIGHT_QUERY_MARGIN_MS);
  const hi = new Date(untilMs + FLIGHT_QUERY_MARGIN_MS);
  return prisma.flight.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      OR: [
        {
          departureTime: { gte: new Date(lo.getTime() - MAX_FLIGHT_SPAN_MS), lte: hi },
          OR: [{ arrivalTime: null }, { arrivalTime: { gte: lo } }],
        },
        { departureTime: null, arrivalTime: { gte: lo, lte: hi } },
      ],
    },
    select: { id: true, ...FLIGHT_WINDOW_SELECT },
  });
}
