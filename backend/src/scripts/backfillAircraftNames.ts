import { prisma } from "../db";
import { normalizeAircraft } from "../utils/aircraftNormalize";
import logger from "../utils/logger";

/**
 * One-shot, idempotent backfill: rewrite stored free-text aircraft types to the
 * catalogue's canonical display name.
 *
 * `normalizeAircraft` has existed since the catalogue landed, but it only ever
 * ran on the WRITE path — so a library built up over years reads as a mixture
 * of vocabularies in the same column: "Airbus A350-900" next to "B737-800",
 * "A320neo" and "B737 MAX 8-200". Measured on a real 335-flight install, the
 * aircraft column held all three shapes at once.
 *
 * Safe by construction: `normalizeAircraft` maps a known alias or ICAO code to
 * the canonical name and returns anything it does not recognise trimmed but
 * UNCHANGED. A row is only written when the normalised value actually differs,
 * so re-running is a no-op and an unrecognised type is never mangled.
 */
export async function backfillAircraftNames(): Promise<number> {
  const flights = await prisma.flight.findMany({
    where: { aircraft: { not: null } },
    select: { id: true, aircraft: true },
  });

  let updated = 0;
  for (const f of flights) {
    if (!f.aircraft) continue;
    const canonical = normalizeAircraft(f.aircraft);
    if (!canonical || canonical === f.aircraft) continue;
    await prisma.flight.update({
      where: { id: f.id },
      data: { aircraft: canonical },
    });
    updated++;
  }

  if (updated > 0) {
    logger.info({
      operation: "backfill_aircraft_names_done",
      updated,
      scanned: flights.length,
    });
  }
  return updated;
}
