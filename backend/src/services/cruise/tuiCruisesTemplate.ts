/**
 * A deterministic reader for TUI Cruises ("Mein Schiff") booking
 * confirmations.
 *
 * Why this exists: until now the cruise pipeline had exactly one path, and it
 * was the LLM. `parseCruiseBookingText` asked whether Ollama answered and
 * threw if it did not — so an instance without a local model could not import
 * a cruise booking at all. Flights and hotels both have a deterministic path
 * and fall back to the model; cruises had only the fall-back. Measured against
 * the sample set, all four cruise confirmations failed for that reason alone
 * and not because anything in them was hard to read.
 *
 * The format is a fixed-position PDF, so this reads anchors rather than prose:
 *
 *     Mein Schiff 1<TAB>Ihr Schiff:
 *     Ihre Reise: 11 Nächte - Neuengland und Kanada - ab/bis Bayonne
 *     Vorgang-Nr.: 4507252/4
 *     ...
 *     1-2 08.10.2027 -
 *     29.10.2027
 *     Mein Schiff 1
 *     Junior Suite Balkon (2er Belegung)
 *     Deck 10 - Perle - Kabine 10075
 *     Änderungen der Termine, Route, Tendern, Liegezeiten
 *     vorbehalten
 *     08.10.2027 Bayonne (New York) - 09.10.2027 Seetag - ...
 *     2 x Kreuzfahrtpreis 7.698,00 €<TAB>3.849,00 €<TAB>1-2
 *
 * One confirmation can carry SEVERAL cruises — a back-to-back booking repeats
 * the whole cabin block, and the header's "Ihre Reise:" then lists one line per
 * leg. Each cabin block is therefore one cruise, and the header is only used
 * for what a block cannot say for itself.
 *
 * What it deliberately does NOT do: guess. A field it cannot read is left
 * absent and named in `missing`, so the caller can decide whether to ask the
 * model instead. Abstention is a result — the same rule the rest of the
 * codebase follows for derived values.
 */

import type { ParsedCruise, ParsedCruiseStop, CruiseCabinType } from "../cruiseBookingParser";

/** What `parserTemplate` says on a cruise this module produced. */
export const TUI_TEMPLATE_ID = "tui-cruises-confirmation";

/**
 * Anchors that together identify the issuer. Two, not one: "Mein Schiff" alone
 * appears in unrelated marketing mail, and a confirmation that mentions the
 * ship without being from TUI would then be read with the wrong grammar.
 */
const ISSUER_ANCHORS = [/TUI\s+Cruises\s+GmbH/i, /meinschiff\.com/i];

/** The cabin line is the one thing every segment has exactly once. */
const CABIN_LINE = /^Deck\s+(\d{1,2})\s+-\s+[^-]+-\s+Kabine\s+([0-9A-Za-z]+)\s*$/;

const SHIP_LINE = /^(Mein Schiff\s+[0-9A-Za-z]+)\b/;
const BOOKING_REF = /Vorgang-Nr\.?:\s*([0-9]+)(?:\/[0-9]+)?/;
/**
 * "Ihre Reise: 11 Nächte - Neuengland und Kanada - ab/bis Bayonne".
 *
 * The label is written ONCE for a back-to-back booking and the further legs
 * follow as bare continuation lines without it, so the prefix is optional
 * here. Requiring it named only the first leg and left the second routeless.
 */
const ROUTE_LINE = /^(?:Ihre Reise:\s*)?\d+\s+N[äa]chte\s*-\s*(.+?)\s*-\s*ab(?:\/bis|\s)/i;
const PRICE_LINE = /(\d+)\s*x\s*Kreuzfahrtpreis\s+([\d.]+,\d{2})\s*€/;
const DATE = /(\d{2})\.(\d{2})\.(\d{4})/;

/** German day-month-year to an ISO calendar day. */
function isoDay(day: string, month: string, year: string): string {
  return `${year}-${month}-${day}`;
}

/** "7.698,00" → 7698. Returns null rather than NaN on anything unexpected. */
function germanAmount(raw: string): number | null {
  const normalised = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : null;
}

/**
 * The cabin CATEGORY line sits directly above the deck line and names the
 * type in German prose: "Junior Suite Balkon (2er Belegung)",
 * "Himmel & Meer Suite", "Verandakabine", "Innenkabine".
 *
 * Suite wins over balcony where both words appear — a "Junior Suite Balkon" is
 * a suite with a balcony, and the type field records the category that was
 * paid for, which is the more specific one.
 */
export function cabinTypeFromCategory(category: string): CruiseCabinType | undefined {
  const text = category.toLowerCase();
  if (/\bsuite\b/.test(text)) return "suite";
  if (/balkon|veranda/.test(text)) return "balcony";
  if (/außen|aussen|meerblick|ocean/.test(text)) return "oceanview";
  if (/innen/.test(text)) return "inside";
  return undefined;
}

/**
 * The itinerary is one run-on chain wrapped across lines:
 * "08.10.2027 Bayonne (New York) - 09.10.2027 Seetag - 10.10.2027 Boston".
 *
 * It is split on the DATES, not on the hyphens — a port name contains hyphens
 * of its own ("Baie-Comeau"), and splitting on those would cut a port in half
 * and invent a stop.
 */
export function parseItinerary(chain: string): ParsedCruiseStop[] {
  const matches = [...chain.matchAll(/(\d{2})\.(\d{2})\.(\d{4})\s+/g)];
  const stops: ParsedCruiseStop[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const from = (match.index ?? 0) + match[0].length;
    const to = i + 1 < matches.length ? (matches[i + 1].index ?? chain.length) : chain.length;
    const label = chain
      .slice(from, to)
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*$/, "")
      .trim();
    if (!label) continue;

    const date = isoDay(match[1], match[2], match[3]);
    const atSea = /^seetag$/i.test(label);
    stops.push({
      dayNumber: stops.length + 1,
      date,
      isAtSea: atSea,
      // The three-state invariant (CLAUDE.md): a sea day carries no port name
      // at all, rather than an empty one.
      ...(atSea ? {} : { portName: label }),
    });
  }
  return stops;
}

interface Segment {
  shipName?: string;
  cabinCategory?: string;
  deck?: number;
  cabinNumber?: string;
  stops: ParsedCruiseStop[];
  price?: number;
}

/**
 * Cut the document into one segment per cabin block.
 *
 * The cabin line is the anchor because it is the only line that appears
 * exactly once per cruise and never anywhere else: the ship name also appears
 * in the letterhead, the dates appear in the payment schedule, and the price
 * appears again in the invoice total.
 */
function readSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const cabin = CABIN_LINE.exec(lines[i].trim());
    if (!cabin) continue;

    const segment: Segment = {
      deck: Number.parseInt(cabin[1], 10),
      cabinNumber: cabin[2],
      stops: [],
    };

    // Ship and cabin category sit directly above, in that order. Bounded to
    // four lines so a segment cannot borrow the previous one's ship.
    for (let back = i - 1; back >= 0 && back >= i - 4; back -= 1) {
      const line = lines[back].trim();
      const ship = SHIP_LINE.exec(line);
      if (ship && !segment.shipName) {
        segment.shipName = ship[1].replace(/\s+/g, " ");
        break;
      }
      if (!segment.cabinCategory && line && !/^\d/.test(line)) segment.cabinCategory = line;
    }

    // The itinerary follows, then the tariff name, then the price. Two passes,
    // because the tariff lines sit BETWEEN them: scanning for the price in the
    // same loop that reads the chain stops at "Premium Alles Inklusive" and
    // never reaches it — which is exactly how every price came back undefined
    // on the first run against the sample set.
    const chain: string[] = [];
    let after = lines.length;
    for (let fwd = i + 1; fwd < lines.length; fwd += 1) {
      const line = lines[fwd].trim();
      if (/^Änderungen der Termine|^vorbehalten$/i.test(line)) continue;
      // A page break interrupts the chain but not the cruise.
      if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(line) || /^Seite\s+\d+$/.test(line)) continue;
      if (/^(Datum|Vorgang)\b/.test(line)) continue;
      if (DATE.test(line) || chain.length > 0) {
        // The tariff name ends the chain — the first line after the itinerary
        // that carries no date.
        if (!DATE.test(line) && chain.length > 0) {
          after = fwd;
          break;
        }
        chain.push(line);
      }
    }

    // Bounded, so a segment whose own price is missing cannot pick up the
    // NEXT segment's — the two are more than a dozen lines apart.
    for (let fwd = after; fwd < lines.length && fwd < after + 12; fwd += 1) {
      const line = lines[fwd].trim();
      if (CABIN_LINE.test(line)) break;
      const price = PRICE_LINE.exec(line);
      if (price) {
        segment.price = germanAmount(price[2]) ?? undefined;
        break;
      }
    }

    segment.stops = parseItinerary(chain.join(" "));
    if (segment.stops.length > 0) segments.push(segment);
  }

  return segments;
}

/** Does this text look like a TUI Cruises confirmation? */
export function matchesTuiCruises(text: string): boolean {
  return ISSUER_ANCHORS.some((anchor) => anchor.test(text));
}

/**
 * Read every cruise in a TUI Cruises confirmation.
 *
 * Returns an empty array when the document is not one, or when no segment
 * could be read — the caller then falls back to the model rather than storing
 * a half-read booking.
 */
export function parseTuiCruisesConfirmation(text: string): ParsedCruise[] {
  if (!matchesTuiCruises(text)) return [];

  const lines = text.split(/\r?\n/);
  const segments = readSegments(lines);
  if (segments.length === 0) return [];

  const bookingReference = BOOKING_REF.exec(text)?.[1];
  // One route line per leg, in the order the legs appear.
  const routeNames = lines
    .map((line) => ROUTE_LINE.exec(line.trim())?.[1])
    .filter((name): name is string => !!name);

  return segments.map((segment, index) => {
    const first = segment.stops[0];
    const last = segment.stops[segment.stops.length - 1];
    const missing: string[] = [];
    if (!segment.shipName) missing.push("shipName");
    if (!bookingReference) missing.push("bookingReference");
    if (segment.price === undefined) missing.push("price");

    const cabinType = segment.cabinCategory
      ? cabinTypeFromCategory(segment.cabinCategory)
      : undefined;
    if (!cabinType) missing.push("cabinType");

    return {
      ...(segment.shipName ? { shipName: segment.shipName } : {}),
      cruiseLine: "TUI Cruises",
      ...(routeNames[index] ? { routeName: routeNames[index] } : {}),
      ...(first?.date ? { startDate: first.date } : {}),
      ...(last?.date ? { endDate: last.date } : {}),
      ...(first?.portName ? { departurePortName: first.portName } : {}),
      ...(last?.portName ? { arrivalPortName: last.portName } : {}),
      ...(segment.cabinNumber ? { cabinNumber: segment.cabinNumber } : {}),
      ...(cabinType ? { cabinType } : {}),
      ...(segment.deck !== undefined ? { deck: segment.deck } : {}),
      ...(bookingReference ? { bookingReference } : {}),
      ...(segment.price !== undefined ? { price: segment.price } : {}),
      // The confirmation is issued by a German company and prices it in euros
      // throughout; there is no currency symbol to read other than €.
      ...(segment.price !== undefined ? { currency: "EUR" as const } : {}),
      stops: segment.stops,
      flights: [],
      parserTemplate: TUI_TEMPLATE_ID,
      // Deliberately above the model's 80: every field here was read from a
      // fixed position, not inferred.
      parserConfidence: 95,
      missing,
    };
  });
}
