import logger from "../../../utils/logger";
import type { ParsedBooking } from "../../bookingParser";

/**
 * What makes a parsed candidate a flight rather than a coincidence.
 *
 * A flight number, or both ends of a route. A date is NOT evidence: every
 * marketing email carries one, and a date alone is exactly what turned an
 * Emirates promotion into a booking (Forgejo #17).
 *
 * The rule lives here rather than inside one parser because it is a property
 * of the ANSWER, not of the technique that produced it. #17 was fixed only in
 * `regexParser`, and `email.ts` states the ordering plainly — "Templates become
 * the fallback when Ollama is unavailable or returns no results" — so on every
 * instance with Ollama configured, which is how prod and the RC run, the
 * guarded path was the one that did not execute. The rc.27 mail run then
 * produced three flights with every field null from a "30 EUR Oster-Geschenk"
 * promotion (Forgejo #35).
 *
 * So: one rule, applied to whatever the chosen provider returns.
 */
export function hasFlightEvidence(booking: Partial<ParsedBooking>): boolean {
  const hasFlightNumber = Boolean(booking.flightNumber);
  const hasRoute = Boolean(booking.departureCode && booking.arrivalCode);
  return hasFlightNumber || hasRoute;
}

/**
 * Drop candidates that identify no flight, and say how many went.
 *
 * Deliberately silent when nothing is dropped: a log line per parse would bury
 * the case that matters. `context.provider` is carried so the log can answer
 * "which parser invented these", which is the question #35 had to reconstruct
 * from a JSONL summary.
 */
export function keepOnlyFlightsWithEvidence(
  flights: ParsedBooking[],
  provider: string
): ParsedBooking[] {
  const kept = flights.filter((f) => hasFlightEvidence(f));
  if (kept.length !== flights.length) {
    logger.info({
      operation: "parser_candidate_without_evidence_dropped",
      message: "Discarded candidates carrying neither a flight number nor a route",
      context: { provider, dropped: flights.length - kept.length, kept: kept.length },
    });
  }
  return kept;
}
