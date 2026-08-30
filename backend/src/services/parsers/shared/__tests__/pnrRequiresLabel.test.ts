import { describe, it, expect } from '@jest/globals';

import { extractFlightDataFromText } from '../utils';

/**
 * A booking reference has to be labelled, or marketing mail becomes a booking.
 *
 * Forgejo #17: two ordinary promotional emails were parsed as flights on a
 * fresh RC. One came back with booking reference "LEIDER", the other with
 * "NSCHEN" — the tail of "WÜNSCHEN", because the umlaut breaks the regex word
 * boundary and leaves six clean letters behind.
 *
 * The old pattern was `/\b([A-Z0-9]{6})\b/` against text the caller
 * upper-cases first, so it matched the first six-letter word in any German
 * sentence. It was not occasionally wrong; it was a coin toss dressed as data.
 *
 * The cases below use the real German words from the reported samples, because
 * an invented fixture would not have caught the umlaut behaviour that made
 * "NSCHEN" possible.
 */
describe('booking reference extraction', () => {
  it.each([
    ['LEIDER nur für kurze Zeit: Emirates-Flüge ab 380 EUR', 'LEIDER'],
    ['Wir WÜNSCHEN Ihnen frohe Feiertage!', 'NSCHEN'],
    ['ANGEBOT gültig bis Ende der Woche', 'ANGEBO'],
  ])('does not read a reference out of %j', (text) => {
    const result = extractFlightDataFromText(text.toUpperCase());
    expect(result.pnr).toBeUndefined();
    expect(result.bookingReference).toBeUndefined();
  });

  it.each([
    ['Buchungsreferenz: 9RFAA7', '9RFAA7'],
    ['Booking reference 85LMUN', '85LMUN'],
    ['Ihre Buchungsnummer K6CH9R finden Sie hier', 'K6CH9R'],
    ['PNR: 7RH6NS', '7RH6NS'],
    ['Confirmation code 9C2R2U', '9C2R2U'],
    ['Record locator XY12AB', 'XY12AB'],
  ])('still reads a labelled reference out of %j', (text, expected) => {
    const result = extractFlightDataFromText(text.toUpperCase());
    expect(result.pnr).toBe(expected);
    expect(result.bookingReference).toBe(expected);
  });

  it('takes the labelled code, not the first six-letter word before it', () => {
    // The discriminating case: both are present, and the old pattern would
    // have grabbed the wrong one because it appears first.
    const text = 'LEIDER ausgebucht. Buchungsreferenz: 9RFAA7';
    expect(extractFlightDataFromText(text.toUpperCase()).pnr).toBe('9RFAA7');
  });
});
