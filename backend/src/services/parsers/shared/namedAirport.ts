import logger from '../../../utils/logger';
import type { ParsedBooking } from '../../bookingParser';

/**
 * A named airport beats a city code (GitHub #287, the follow-up case).
 *
 * A Germanwings confirmation from 2008 prints "11:40 München  12:50
 * Berlin-Schönefeld". The LLM parser is told to answer in IATA codes, and it
 * answered `BER` — the code of the city, which since 2020 is the code of
 * Berlin Brandenburg. The code search then did exactly what it was asked and
 * two 2008 flights were filed into an airport that opened twelve years later.
 *
 * The mail named the airport. The catalogue knows that name, on a closed row
 * (`SXF`, Berlin-Schönefeld). So when the text carries the distinctive part of
 * another airport's name in the SAME city as the returned code, that airport
 * is the one the mail meant, and its code replaces the model's.
 *
 * Deliberately narrow, on the same terms as `routeFromText.ts`:
 *   - only airports of the code's own city are candidates, so "Tegel" in a
 *     Munich leg changes nothing;
 *   - a candidate needs a distinctive word of at least five letters that is
 *     not the city's name, so "Berlin Brandenburg Airport" is matched on
 *     "brandenburg" and never on "berlin";
 *   - exactly one candidate may match; two ("Tegel" and "Schönefeld" on one
 *     leg) leave the code alone, because a guessed airport is the more
 *     expensive mistake;
 *   - if the text also names the returned code's own airport distinctively,
 *     the model was right and nothing changes.
 */

export interface CatalogueAirport {
  iata: string | null;
  icao: string | null;
  name: string;
  city: string | null;
  isClosed: boolean;
}

/** All catalogue rows of the city the code belongs to, closed ones included. */
export type AirportsInCityOf = (code: string) => Promise<CatalogueAirport[]>;

const GENERIC_WORDS = new Set([
  'airport',
  'airfield',
  'aerodrome',
  'flughafen',
  'flugplatz',
  'international',
  'intl',
  'regional',
  'heliport',
  'helipad',
]);

/** Lower-case, umlauts to their two-letter spelling, other marks stripped, letters only. */
export function foldForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** The words of an airport's name that could only mean this airport. */
export function distinctiveWords(airport: CatalogueAirport): string[] {
  const cityWords = new Set(foldForMatch(airport.city ?? '').split(' ').filter(Boolean));
  return foldForMatch(airport.name)
    .split(' ')
    .filter((word) => word.length >= 5 && !GENERIC_WORDS.has(word) && !cityWords.has(word));
}

function mentions(foldedText: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`).test(foldedText));
}

/**
 * The code the text actually names, or null when the model's code stands.
 * Exported so the decision can be tested without a catalogue behind it.
 */
export function namedAirportCode(
  code: string,
  foldedText: string,
  cityAirports: CatalogueAirport[]
): string | null {
  const own = cityAirports.filter((a) => a.iata === code);
  if (own.some((a) => mentions(foldedText, distinctiveWords(a)))) return null;

  const named = cityAirports.filter(
    (a) => a.iata && a.iata !== code && mentions(foldedText, distinctiveWords(a))
  );
  const codes = [...new Set(named.map((a) => a.iata as string))];
  return codes.length === 1 ? codes[0] : null;
}

/**
 * Replace a city code with the airport the text names, on both ends of every
 * flight that has a code. Runs after the route backfill, so a recovered route
 * is checked as well.
 */
export async function preferNamedAirports(
  flights: ParsedBooking[],
  text: string,
  airportsInCityOf: AirportsInCityOf
): Promise<ParsedBooking[]> {
  const folded = foldForMatch(text);
  const cache = new Map<string, CatalogueAirport[]>();
  const cityOf = async (code: string): Promise<CatalogueAirport[]> => {
    const hit = cache.get(code);
    if (hit) return hit;
    const rows = await airportsInCityOf(code);
    cache.set(code, rows);
    return rows;
  };

  const result: ParsedBooking[] = [];
  for (const flight of flights) {
    let next = flight;
    for (const side of ['departureCode', 'arrivalCode'] as const) {
      const code = next[side];
      if (!code) continue;
      const named = namedAirportCode(code, folded, await cityOf(code));
      if (!named) continue;
      logger.info(
        { operation: 'parser_named_airport', side, from: code, to: named },
        'A named airport beats the city code'
      );
      next = { ...next, [side]: named };
    }
    result.push(next);
  }
  return result;
}
