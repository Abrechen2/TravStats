import { prisma } from "../db";
import type { Flight } from "../prisma";
import logger from "../utils/logger";
import { deriveFlightStatus } from "../shared/statusDerivation";

/**
 * A touchdown the provider reports ends "scheduled" at once (2026-10-03: a
 * tester saw a flight still "geplant" 2.5 h after landing). Only the status
 * moves here: it is derived, not the user's data. The reported times still go
 * through the pending update under the user's review rule. Callers run this
 * AFTER the rotation guard, so another day's aircraft can never land a flight.
 *
 * The same step serves a paired phone's observed landing (forgejo#194), which
 * names itself in `modifiedBy` so the row says who ended "scheduled".
 *
 * Returns whether the flight was marked flown.
 */
export async function markFlownOnReportedLanding(
  flight: Pick<Flight, "id" | "status" | "departureTime" | "arrivalTime">,
  reportedActualArrival: string | null | undefined,
  modifiedBy: string = "auto_update"
): Promise<boolean> {
  if (!reportedActualArrival || flight.status !== "scheduled") return false;
  const landed =
    deriveFlightStatus({
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      actualArrival: new Date(reportedActualArrival),
      current: flight.status,
    }) === "flown";
  if (!landed) return false;
  await prisma.flight.update({
    where: { id: flight.id },
    data: { status: "flown", lastModifiedBy: modifiedBy, nextApiCheckAt: null },
  });
  logger.info(
    { flightId: flight.id, operation: "flight_landed_status_flown", modifiedBy },
    "Landing reported; flight marked flown"
  );
  return true;
}
