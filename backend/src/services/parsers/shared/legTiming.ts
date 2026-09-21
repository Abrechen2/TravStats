/**
 * Is this pair of timestamps one flight leg, or two documents stapled
 * together?
 *
 * The parsers pair dates POSITIONALLY: the first date found is the departure,
 * the next one the arrival. Inside one confirmation that is right often
 * enough. Across two, it is never right, and it fails silently — the result
 * looks like an ordinary candidate and the review form opens over it.
 *
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-PARSER-001): a PDF holding
 * two separate invoices came back as ONE flight BA117 departing 15.07.2025
 * and arriving 10.07.2025. The candidate named its missing airport codes and
 * said nothing at all about arriving five days before it left. The same shape
 * appears in the multi-leg fixture, where an outbound on 10.10. was paired
 * with a return on 17.10. as a seven-day flight.
 *
 * So the window, and why it is not simply "arrival after departure":
 *
 * - These are LOCAL wall-clock times with no zone attached, and a westward
 *   leg legitimately lands at an earlier clock reading than it left at. Over
 *   the date line it lands on the earlier CALENDAR DAY: Apia to Pago Pago is
 *   half an hour long and arrives yesterday. One day back is therefore real.
 * - In the other direction the extremes stack: the longest scheduled flights
 *   run about 19 hours, and a departure at UTC-11 arriving at UTC+14 adds 25
 *   more to the clock. Two days is past anything an airline sells.
 *
 * Outside that window the pairing is not evidence, and the ABSTENTION is the
 * result: the arrival is dropped and reported missing, rather than a wrong
 * number being carried into a flight row, a duration and every average built
 * on it.
 */

/** A leg may land up to one calendar day before it departed — the date line. */
export const MAX_ARRIVAL_BEFORE_DEPARTURE_MS = 24 * 60 * 60 * 1000;

/** Longest flight (~19 h) plus the widest clock jump (~25 h), rounded up. */
export const MAX_LEG_SPAN_MS = 48 * 60 * 60 * 1000;

/**
 * True when `arrival` can belong to the same leg as `departure`.
 *
 * Abstains — returns true — whenever it cannot tell: a missing or unparseable
 * timestamp is not evidence of a mismatch, and dropping a value on a failed
 * `Date.parse` would silently delete good data on a format nobody anticipated.
 */
export function isPlausibleLegArrival(
  departureTime: string | undefined,
  arrivalTime: string | undefined
): boolean {
  if (!departureTime || !arrivalTime) return true;

  const departure = Date.parse(departureTime.replace(" ", "T"));
  const arrival = Date.parse(arrivalTime.replace(" ", "T"));
  if (Number.isNaN(departure) || Number.isNaN(arrival)) return true;

  const delta = arrival - departure;
  return delta >= -MAX_ARRIVAL_BEFORE_DEPARTURE_MS && delta <= MAX_LEG_SPAN_MS;
}
