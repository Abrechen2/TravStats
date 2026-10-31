import { Flight, Prisma } from "../prisma";

/** The columns the candidate test and the confidence read — nothing else (forgejo#339). */
export const ENRICHMENT_CANDIDATE_SELECT = {
  id: true,
  flightNumber: true,
  airline: true,
  aircraft: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  actualRoute: true,
  departureTime: true,
} as const;

/**
 * A flight that lacks none of the five fields is never a candidate: said in
 * SQL instead of reading ten years of full rows. Mirrors the JS test that
 * stays as the final word (`!flight.aircraft`, `!actualRoute || []`).
 */
export const MISSING_ENRICHMENT_FIELD: Prisma.FlightWhereInput = {
  OR: [
    { aircraft: null },
    { aircraft: "" },
    { depIcao: null },
    { depIcao: "" },
    { arrIcao: null },
    { arrIcao: "" },
    { actualRoute: { equals: Prisma.DbNull } },
    { actualRoute: { equals: Prisma.JsonNull } },
    { actualRoute: { equals: [] } },
  ],
};

/**
 * Calculate basic confidence for a candidate (before aggregation)
 */
export function calculateBasicConfidence(
  flight: Pick<Flight, "flightNumber" | "airline" | "depIata" | "depIcao" | "arrIata" | "arrIcao">,
  missingFields: string[]
): number {
  let confidence = 50; // Base confidence

  // More confidence if flight number is present
  if (flight.flightNumber) {
    confidence += 20;
  }

  // Less confidence if many fields are missing
  confidence -= missingFields.length * 5;

  // More confidence if at least some data exists
  if (flight.airline) confidence += 10;
  if (flight.depIata || flight.depIcao) confidence += 10;
  if (flight.arrIata || flight.arrIcao) confidence += 10;

  return Math.max(0, Math.min(100, confidence));
}
