/**
 * Recover a route the provider dropped, from codes the mail prints in brackets.
 *
 * Forgejo #35. An Air France confirmation writes each leg as
 * "München, München (MUC), DEUTSCHLAND" — the airport name first, its code
 * parenthesised behind it. Ollama returns those legs with `departureCode` and
 * `arrivalCode` null anyway, and nothing downstream put them back: the email
 * post-processing backfills PNR, gate, terminal, seat and airline, but never
 * the route.
 *
 * Why brackets rather than a vocabulary check — both obvious alternatives were
 * measured against the archived mails and both fail:
 *
 *   - The full airport catalogue (9065 IATA codes) contains 30 of the 39
 *     three-letter tokens that ordinary German prose in these mails throws off:
 *     DIE, DER, DAS, UND, BEI, EIN, IST, MIT are all airports somewhere. As a
 *     filter over running text it is worthless.
 *   - `COMMON_VALID_IATA_CODES` in `./utils` is clean, but it is a hand-kept
 *     set of ~150 codes and does NOT contain NTE — Nantes, which is precisely
 *     the leg #35 reported as lost. It would have looked like a fix while still
 *     dropping the route that was filed.
 *
 * A bracketed three-letter code is a STRUCTURAL marker instead of a
 * vocabulary one, and German prose does not write "(UND)".
 */

/** A three-letter uppercase code in brackets: the `(MUC)` in "München (MUC)". */
const PARENTHESISED_CODE = /\(([A-Z]{3})\)/g;

/**
 * The bracketed codes in reading order, duplicates kept.
 *
 * Order carries the itinerary: a four-leg booking prints
 * MUC, CDG, CDG, NTE, NTE, CDG, CDG, MUC — departure and arrival alternating,
 * which is what {@link backfillRoutesFromText} relies on.
 */
export function parenthesisedCodes(text: string): string[] {
  return [...text.matchAll(PARENTHESISED_CODE)].map((match) => match[1]);
}

/**
 * Fill in `departureCode`/`arrivalCode` on flights that carry neither.
 *
 * Deliberately all-or-nothing: the codes are only used when there are exactly
 * two per flight, so they can be paired positionally with confidence. Anything
 * else — a stray bracketed word, an e-ticket that prints its codes bare, a
 * partial match — leaves the route null. A null route is honest and the
 * evidence rule then drops the candidate; a GUESSED route is a wrong flight in
 * someone's logbook, which is the more expensive mistake.
 *
 * A flight that already has both ends is never touched, so a provider that got
 * the route right keeps it.
 *
 * Note the interaction with `keepOnlyFlightsWithEvidence`: this runs first, so
 * a backfilled route can turn an evidence-less candidate into a kept one. That
 * is intended — a candidate with a real printed route IS a flight. It does not
 * reopen #17/#35, because a marketing mail prints no bracketed codes at all:
 * the "30 EUR Oster-Geschenk" promotion that produced three phantom flights
 * yields zero matches and stays dropped.
 */
export function backfillRoutesFromText<T extends { departureCode?: string; arrivalCode?: string }>(
  flights: T[],
  text: string
): T[] {
  const missing = flights.filter((f) => !f.departureCode && !f.arrivalCode);
  if (missing.length === 0) return flights;

  const codes = parenthesisedCodes(text);
  if (codes.length !== flights.length * 2) return flights;

  return flights.map((flight, index) => {
    if (flight.departureCode || flight.arrivalCode) return flight;
    return { ...flight, departureCode: codes[index * 2], arrivalCode: codes[index * 2 + 1] };
  });
}
