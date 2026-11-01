import { AppError } from "../middleware/errorHandler";

const REFUSALS = {
  ENRICH_DISABLED: [400, "Historical enrichment is disabled. Enable it in settings."],
  ENRICH_NO_FLIGHT_NUMBER: [400, "Flight number is required for historical enrichment"],
  ENRICH_NO_REFERENCE: [
    404,
    "Could not find enough live-tracked flights with the same flight number to enrich this flight.",
  ],
  ENRICH_CONFIDENCE_LOW: [400, "Confidence is below your minimum threshold."],
} as const;

/**
 * The refusals of `POST /flights/:id/enrich-historical`, each with the stable
 * code the web caller maps to its own copy (forgejo#397). A module of its own
 * because both the route and the enrichment service are at their file-size
 * ceilings.
 */
export function enrichmentRefusal(
  code: keyof typeof REFUSALS,
  extra?: Readonly<Record<string, number>>
): AppError {
  const [status, message] = REFUSALS[code];
  return new AppError(message, status, code, undefined, extra);
}
