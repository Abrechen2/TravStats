/**
 * Regression tests for the Emirates booking-PDF layout (prod booking
 * H68W8S, 2026-08-11) — the column layout that broke the regex parser in
 * three distinct ways:
 *
 *   1. Two-digit years ("05. Aug. 26") never matched (pattern required \d{4}),
 *      so the actual legs carried NO dates at all.
 *   2. "Emir-Erlass Nr. 2 von 1985" in the legal footer parsed as the date
 *      1985-01-02 ("von" defaulted to month '01').
 *   3. Times live on their own line ABOVE a weekday line above the date line
 *      ("06:00\nDienstag\n11. Aug. 26") and were never associated.
 *
 * The fixture is sanitised (fake PNR / passenger); the layout mirrors the
 * text that pdf-parse extracts from the real booking.
 */
import { RegexTextParser } from '../services/parsers/text/regexParser';
import {
  extractAllTimePairs,
  resolveMonth,
  resolvePlausibleYear,
} from '../services/parsers/text/regexDateExtractor';

// Dynamic year keeps the plausible-year window from aging the fixture out.
const YEAR = new Date().getUTCFullYear() + 1;
const YY = String(YEAR % 100).padStart(2, '0');

const EMIRATES_TEXT = `Ihre Buchung ist bestätigt
Buchungsreferenz AB12CD
Mittwoch 5. August ${YEAR}
MUC \tSYD
Dienstag 11. August ${YEAR}
Ihr Reiseplan
Abflug \t| \tMünchen nach Sydney \t| \tReisezeit: 23 Std. 35 Min.
Start \tAnkunft
MUC
München DXB
Dubai
22:30
Mittwoch
05. Aug. ${YY}
06:30
Donnerstag
06. Aug. ${YY}
Flug
EK052
Flugzeugtyp
Boeing
777-300ER
Stopps
Direktflug
Dauer
06 Std. 00 Min.
Verbindung in Dubai: 3 Std. 40 Min
Start \tAnkunft
DXB
Dubai SYD
Sydney
10:10
Donnerstag
06. Aug. ${YY}
06:05
Freitag
07. Aug. ${YY}
Flug
EK412
Flugzeugtyp
Airbus A380-800
Ankunft \t| \tSydney nach München \t| \tReisezeit: 22 Std. 40 Min.
Start \tAnkunft
Flug

-- 2 of 6 --

SYD
Sydney
DXB
Dubai
06:00
Dienstag
11. Aug. ${YY}
14:10
Dienstag
11. Aug. ${YY}
EK415 \tFlugzeugtyp
Airbus A380-800
Verbindung in Dubai: 2 Std. 10 Min
Start \tAnkunft
DXB
Dubai
MUC
München
16:20
Dienstag
11. Aug. ${YY}
20:40
Dienstag
11. Aug. ${YY}
Flug
EK051
Flugzeugtyp
Boeing
777-300ER
Alle Zeitangaben in Ortszeit
Passagiere
Mr Max Mustermann
Diese E-Mail wurde Ihnen von Emirates gesendet, einer durch den Emir-Erlass Nr. 2 von 1985 in Dubai (VAE)
gegründete Gesellschaft. Firmensitz: Emirates Group Headquarters, Airport Road, PO Box 686, Dubai, VAE.
`;

describe('resolveMonth', () => {
  it('accepts German/English month names and numerics', () => {
    expect(resolveMonth('Aug')).toBe('08');
    expect(resolveMonth('August')).toBe('08');
    expect(resolveMonth('MÄRZ')).toBe('03');
    expect(resolveMonth('12')).toBe('12');
    expect(resolveMonth('1')).toBe('01');
  });

  it('rejects non-months instead of defaulting to January', () => {
    expect(resolveMonth('von')).toBeNull(); // the 1985 killer
    expect(resolveMonth('Std')).toBeNull(); // "23 Std. 35 Min."
    expect(resolveMonth('of')).toBeNull(); // "-- 2 of 6 --"
    expect(resolveMonth('13')).toBeNull();
    expect(resolveMonth('0')).toBeNull();
  });
});

describe('resolvePlausibleYear', () => {
  const now = new Date().getUTCFullYear();

  it('accepts near-term four-digit years and pivots two-digit years', () => {
    expect(resolvePlausibleYear(String(now))).toBe(now);
    expect(resolvePlausibleYear(String((now + 1) % 100).padStart(2, '0'))).toBe(now + 1);
  });

  it('rejects legal-footer years like 1985', () => {
    expect(resolvePlausibleYear('1985')).toBeNull();
    expect(resolvePlausibleYear('1999')).toBeNull();
    expect(resolvePlausibleYear(String(now + 10))).toBeNull();
  });
});

describe('extractAllTimePairs — Emirates column layout', () => {
  it('pairs each time on the line above (across the weekday line) with its date', () => {
    const pairs = extractAllTimePairs(EMIRATES_TEXT);
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toEqual({
      departure: `${YEAR}-08-05T22:30`,
      arrival: `${YEAR}-08-06T06:30`,
    });
    expect(pairs[1]).toEqual({
      departure: `${YEAR}-08-06T10:10`,
      arrival: `${YEAR}-08-07T06:05`,
    });
    // The leg that shipped one day early in prod: must be the 11th, 06:00.
    expect(pairs[2]).toEqual({
      departure: `${YEAR}-08-11T06:00`,
      arrival: `${YEAR}-08-11T14:10`,
    });
    expect(pairs[3]).toEqual({
      departure: `${YEAR}-08-11T16:20`,
      arrival: `${YEAR}-08-11T20:40`,
    });
  });

  it('drops the date-only header lines instead of shifting every pair', () => {
    const pairs = extractAllTimePairs(EMIRATES_TEXT);
    // "Mittwoch 5. August ${YEAR}" / "Dienstag 11. August ${YEAR}" carry no
    // time — with timed pairs present they are page furniture, not legs.
    expect(pairs.some(p => p.departure?.endsWith('T00:00'))).toBe(false);
  });

  it('never fabricates a date from the 1985 legal footer', () => {
    const pairs = extractAllTimePairs(EMIRATES_TEXT);
    expect(pairs.some(p => p.departure?.startsWith('1985') || p.arrival?.startsWith('1985'))).toBe(
      false
    );
  });

  it('does not steal the next cell\'s time across a newline', () => {
    // "11. Aug. ${YY}\n14:10" — 14:10 belongs to the SECOND date, not the first.
    const pairs = extractAllTimePairs(EMIRATES_TEXT);
    expect(pairs[2]?.departure).toBe(`${YEAR}-08-11T06:00`);
  });
});

describe('RegexTextParser — Emirates booking end to end', () => {
  it('extracts all four legs with the correct dates and times', async () => {
    const parser = new RegexTextParser();
    const flights = await parser.parseEmail('Ihre Buchung ist bestätigt AB12CD', EMIRATES_TEXT);

    expect(flights).toHaveLength(4);

    const byNumber = new Map(flights.map(f => [f.flightNumber, f]));
    expect([...byNumber.keys()].sort()).toEqual(['EK051', 'EK052', 'EK412', 'EK415']);

    expect(byNumber.get('EK052')?.departureTime).toBe(`${YEAR}-08-05T22:30`);
    expect(byNumber.get('EK052')?.arrivalTime).toBe(`${YEAR}-08-06T06:30`);
    expect(byNumber.get('EK412')?.departureTime).toBe(`${YEAR}-08-06T10:10`);
    expect(byNumber.get('EK412')?.arrivalTime).toBe(`${YEAR}-08-07T06:05`);
    expect(byNumber.get('EK415')?.departureTime).toBe(`${YEAR}-08-11T06:00`);
    expect(byNumber.get('EK415')?.arrivalTime).toBe(`${YEAR}-08-11T14:10`);
    expect(byNumber.get('EK051')?.departureTime).toBe(`${YEAR}-08-11T16:20`);
    expect(byNumber.get('EK051')?.arrivalTime).toBe(`${YEAR}-08-11T20:40`);
  });
});
