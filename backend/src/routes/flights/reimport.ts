import { prisma } from "../../db";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import { resolveOnlineCheckInColumns } from "../../services/deadlines/bookingDeadlines";
import logger from "../../utils/logger";

/**
 * A document import of a flight already in the logbook (`already_imported`,
 * matched by `externalRef`). Nothing is overwritten; the one thing a later
 * document may add is the online check-in opening (forgejo#285) — and only
 * when the stored flight holds none, on its departure airport's clock.
 * Lives here so the frozen `routes/flights.ts` does not grow.
 */
export interface ReimportedFlight {
  id: string;
  /** What this document filled; absent when it filled nothing. */
  filledDeadlines?: Array<"onlineCheckInOpensAt">;
}

export async function findReimportedFlight(
  userId: string,
  externalRef: string,
  data: { onlineCheckInOpensAt?: TimeFieldInput | null },
  viaToken: boolean
): Promise<ReimportedFlight | null> {
  const existing = await prisma.flight.findFirst({
    where: { userId, externalRef },
    select: { id: true, depTimezone: true, onlineCheckInOpensAt: true },
  });
  if (!existing) return null;
  if (!data.onlineCheckInOpensAt || existing.onlineCheckInOpensAt) return { id: existing.id };
  const zone = existing.depTimezone;
  let columns;
  try {
    columns = await resolveOnlineCheckInColumns(
      { onlineCheckInOpensAt: data.onlineCheckInOpensAt },
      { userId, placeZone: () => zone, viaToken }
    );
  } catch (error) {
    // The duplicate answer must not turn into a failure over an extra field:
    // the time is left out, and said so in the log.
    logger.warn({
      operation: "flight_reimport_check_in_dropped",
      flightId: existing.id,
      reason: error instanceof Error ? error.message : String(error),
    });
    return { id: existing.id };
  }
  if (!columns.onlineCheckInOpensAt) return { id: existing.id };
  await prisma.flight.update({ where: { id: existing.id }, data: columns });
  return { id: existing.id, filledDeadlines: ["onlineCheckInOpensAt"] };
}
