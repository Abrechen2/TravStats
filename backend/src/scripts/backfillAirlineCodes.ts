import { prisma } from "../db";
import { resolveAirlineCodes } from "../utils/airlineNormalize";
import logger from "../utils/logger";

/**
 * One-shot, idempotent backfill: for flights that have a free-text `airline`
 * name but no structured `airlineIata`, resolve the codes from the catalogue
 * and fill them. Never overwrites an existing airlineIata. Safe to re-run.
 */
export async function backfillAirlineCodes(): Promise<number> {
  const flights = await prisma.flight.findMany({
    where: { airline: { not: null }, airlineIata: null },
    select: { id: true, airline: true },
  });

  let updated = 0;
  for (const f of flights) {
    if (!f.airline) continue;
    const resolved = resolveAirlineCodes(f.airline);
    if (!resolved) continue;
    await prisma.flight.update({
      where: { id: f.id },
      data: { airlineIata: resolved.iata, airlineIcao: resolved.icao ?? null },
    });
    updated++;
  }

  if (updated > 0) {
    logger.info({ operation: "backfill_airline_codes_done", updated, scanned: flights.length });
  }
  return updated;
}
