import logger from "../../../utils/logger";
import { resolveAirlineCodes } from "../../../utils/airlineNormalize";
import { isCurrencyCode } from "../../../shared/currencies";
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
  const hasRoute = Boolean(booking.departureCode && booking.arrivalCode);
  if (hasRoute) return true;
  return isCredibleFlightNumber(booking.flightNumber);
}

/**
 * A flight number standing ALONE — no route beside it — is evidence only when
 * its letters name an airline.
 *
 * Measured 2026-09-05 on 108 hotel confirmations run through the flight
 * parser: 38 came back as a flight, none with a route, every "number" a price
 * or a word with digits after it — CHF0 fourteen times, SIE20, AED350, NOK0,
 * BIS14, VON08. Each satisfied the old rule ("a flight number or a route"),
 * because the regex parser had picked the first unknown candidate when no
 * known airline was among them, and a number alone was enough.
 *
 * So the letters are asked two questions: are they a currency (ISO 4217 —
 * never an airline), and does the catalogue know them as an airline (IATA or
 * ICAO)? A route beside the number is still evidence on its own, so an airline
 * the catalogue has not heard of loses nothing as long as the mail names the
 * airports — which a real confirmation does.
 */
export function isCredibleFlightNumber(flightNumber: string | undefined): boolean {
  if (!flightNumber) return false;
  const prefix = /^[A-Z]+/.exec(flightNumber.toUpperCase())?.[0] ?? "";
  if (prefix.length < 2 || prefix.length > 3) return false;
  if (isCurrencyCode(prefix)) return false;
  return resolveAirlineCodes(prefix) !== null;
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
