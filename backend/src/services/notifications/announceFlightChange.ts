import type { Flight } from "../../prisma";
import logger from "../../utils/logger";
import type { FlightChange } from "../flightAutoUpdate";
import { notifyFlightChanged } from "./dispatcher";

// Lives beside the dispatcher rather than in flightAutoUpdate.ts, which the
// file-size ratchet holds under 800 lines (forgejo#156).

/**
 * Tell the paired phones about a provider-detected change. Fire-and-forget:
 * the status job must not wait for the relay (the dispatcher bounds its own
 * time) and a push problem must never fail the flight loop.
 */
export function announceChange(
  userId: string,
  flight: Flight,
  changes: FlightChange[],
  opts: { pending: boolean; diverted: boolean; cancelled: boolean }
): void {
  const log = (error: unknown) =>
    logger.warn(
      {
        operation: "flight_change_push_failed",
        flightId: flight.id,
        error: error instanceof Error ? error.message : String(error),
      },
      "Push for a detected flight change failed"
    );
  try {
    notifyFlightChanged(userId, flight, changes, opts).catch(log);
  } catch (error) {
    log(error);
  }
}
