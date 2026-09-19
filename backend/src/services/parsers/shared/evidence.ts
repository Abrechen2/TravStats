import logger from "../../../utils/logger";
import { resolveAirlineCodes } from "../../../utils/airlineNormalize";
import { isCurrencyCode } from "../../../shared/currencies";
import type { ParsedBooking } from "../../bookingParser";

/**
 * What makes a parsed candidate a flight rather than a coincidence.
 *
 * A route — both ends printed — settles it on its own. A flight number does
 * NOT, not by itself: see {@link hasSecondWitness}. A date is no evidence at
 * all: every marketing email carries one, and a date alone is exactly what
 * turned an Emirates promotion into a booking (Forgejo #17).
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
 * So: one rule, applied to whatever the chosen provider returns. `sourceText`
 * is the mail the candidate was read out of — subject, body and HTML joined —
 * because the second witness is a property of the document, not of the fields
 * the provider managed to fill in.
 */
export function hasFlightEvidence(booking: Partial<ParsedBooking>, sourceText: string): boolean {
  const hasRoute = Boolean(booking.departureCode && booking.arrivalCode);
  if (hasRoute) return true;
  if (!isCredibleFlightNumber(booking.flightNumber)) return false;
  return hasSecondWitness(booking.flightNumber ?? "", sourceText);
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
 *
 * This question is necessary and no longer sufficient —
 * {@link hasSecondWitness} says why.
 */
export function isCredibleFlightNumber(flightNumber: string | undefined): boolean {
  if (!flightNumber) return false;
  const prefix = /^[A-Z]+/.exec(flightNumber.toUpperCase())?.[0] ?? "";
  if (prefix.length < 2 || prefix.length > 3) return false;
  if (isCurrencyCode(prefix)) return false;
  return resolveAirlineCodes(prefix) !== null;
}

/** A printed clock time: `07:35`, `7:35`, `23:59`. The colon is the point. */
const TIME_OF_DAY = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/;

/**
 * Phrases a mail addressed to ONE traveller about ONE booking prints, and
 * marketing copy does not.
 *
 * The first cut of this list was single words — `buchung|booking|ticket|
 * abflug|departure|boarding|reservierung` — and review measured it open in
 * both languages. Adding one ordinary sentence of German airline copy,
 * "Regelmäßiger Abflug ab Flughafen Düsseldorf täglich.", put the FB23
 * newsletter straight back to a flight; an English price comparison naming
 * "Booking.com" did the same. Those two are negative tests below.
 *
 * A word like "Abflug" describes a service anyone can advertise. "Ihre
 * Buchung", "Buchungsnummer", "record locator" describe a transaction that
 * has already happened and belongs to the reader — which is the distinction
 * the witness actually needs.
 *
 * German and English side by side because the corpus is both. Matching is
 * case-insensitive and word-boundaried at each end, so "Buchungsnummer:"
 * counts and "Buchungsnummerngenerator" would not.
 */
const CONFIRMATION_PHRASES =
  /\b(?:ihre buchung|deine buchung|buchungsnummer|buchungscode|buchungsbestätigung|reservierungsnummer|reservierungscode|ticketnummer|e-ticket|pnr|your booking|booking reference|booking confirmation|confirmation number|record locator|boarding pass|bordkarte)\b/i;

/**
 * How far either side of the number a clock time still counts as "near it".
 *
 * A confirmation prints the number and its times within a line or two of each
 * other, and 200 characters is about that. Deliberately not "anywhere in the
 * mail": a newsletter printing service hours in its footer would otherwise
 * hand every marketing token a witness.
 */
const WITNESS_WINDOW = 200;

/**
 * The second witness a lone flight number needs before it counts as a flight.
 *
 * GitHub #291. A code can be a real airline and a coincidence at once, which
 * is why {@link isCredibleFlightNumber} cannot decide this alone. The mail
 * that reopened the issue carries no booking in any reading:
 *
 *     Newsletter Oktober
 *     Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.
 *     Flüge nach Barcelona ab 49 EUR.
 *     Ab Flughafen Düsseldorf täglich.
 *
 * "FB" is Bulgaria Air in the catalogue, so the marketing token FB23 passed
 * the airline question; the regex chain then paired it with the only date in
 * the mail and returned
 * `{airline: "FB", flightNumber: "FB23", departureTime: "2026-10-30T00:00"}` —
 * a flight invented out of a Facebook campaign. `IYR724` and `MD2400`, named
 * in the same issue, are the same shape but were already refused one question
 * earlier: neither "IYR" nor "MD" is an airline the catalogue knows.
 *
 * So a lone number must be corroborated by something else that is shaped like
 * a flight:
 *
 *   - a **clock time** within {@link WITNESS_WINDOW} of the number. A booking
 *     says when; a campaign says how cheap.
 *   - a **confirmation phrase** ({@link CONFIRMATION_PHRASES}) anywhere in the
 *     mail. This is what keeps the Emirates confirmations in the corpus whole:
 *     their onward legs print `EK051` with no route at all, and only the
 *     SUBJECT — "Ihre Buchung ist bestätigt" — says the mail is a booking, so
 *     the subject has to stay in scope and the scope has to be the whole
 *     document. That is safe for phrases in a way it was not for words: a
 *     campaign advertises departures, it does not quote your booking number.
 *
 * A route is the third witness and never reaches here: {@link hasFlightEvidence}
 * has already accepted it. A bare DATE is pointedly not a witness — #17, #35
 * and #291 are all marketing mail carrying a date, and admitting one would
 * undo all three.
 *
 * When the number cannot be located in the text — a provider may normalise
 * "EK 0050" to "EK50" — the window opens to the whole mail rather than
 * refusing. Proximity is unmeasurable then, and the alternative is dropping a
 * real booking over a provider's formatting.
 */
export function hasSecondWitness(flightNumber: string, sourceText: string): boolean {
  if (!sourceText) return false;
  if (CONFIRMATION_PHRASES.test(sourceText)) return true;
  return TIME_OF_DAY.test(windowAround(sourceText, flightNumber));
}

/**
 * The slice of the mail around the first printing of the number.
 *
 * Letters and digits are rejoined with `\s*` because the text writes
 * "LH 2316" where the parsed value reads "LH2316".
 */
function windowAround(text: string, flightNumber: string): string {
  const shape = /^([A-Za-z]{2,3})(\d{1,4})$/.exec(flightNumber);
  if (!shape) return text;
  const located = new RegExp(`${shape[1]}\\s*${shape[2]}`, "i").exec(text);
  if (!located) return text;
  const start = Math.max(0, located.index - WITNESS_WINDOW);
  return text.slice(start, located.index + located[0].length + WITNESS_WINDOW);
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
  provider: string,
  sourceText: string
): ParsedBooking[] {
  const kept = flights.filter((f) => hasFlightEvidence(f, sourceText));
  if (kept.length !== flights.length) {
    logger.info({
      operation: "parser_candidate_without_evidence_dropped",
      message: "Discarded candidates that identify no flight",
      context: { provider, dropped: flights.length - kept.length, kept: kept.length },
    });
  }
  return kept;
}
