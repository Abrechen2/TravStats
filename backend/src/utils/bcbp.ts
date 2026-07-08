/**
 * IATA BCBP (Bar Coded Boarding Pass, Resolution 792) "M1" decoder.
 *
 * Decodes the mandatory fixed-width fields of the first leg from the PDF417 /
 * Aztec barcode string a boarding pass carries. The barcode is deterministic
 * and error-corrected, so for the fields it contains (flight number, route,
 * date, seat, PNR, cabin) it is the source of truth — preferred over OCR.
 *
 * Field layout (end-exclusive slices):
 *   0      Format Code ("M")
 *   1      Number of Legs
 *   2-22   Passenger Name (20)
 *   22     Electronic Ticket Indicator
 *   23-30  Operating carrier PNR Code (7)
 *   30-33  From City Airport (3)
 *   33-36  To City Airport (3)
 *   36-39  Operating Carrier Designator (3)
 *   39-44  Flight Number (5)
 *   44-47  Date of Flight, Julian day-of-year (3)
 *   47     Compartment Code (1)
 *   48-52  Seat Number (4)
 *   52-57  Check-in Sequence Number (5)
 */

export interface DecodedBcbp {
  passengerName?: string;
  pnr?: string;
  fromCode?: string;
  toCode?: string;
  carrier?: string;
  /** e.g. "LH123" (carrier + number, leading zeros stripped). */
  flightNumber?: string;
  /** ISO date (yyyy-mm-dd) resolved from the Julian day-of-year. */
  date?: string;
  seatNumber?: string;
  /** Compartment / booking-class letter (e.g. "Y", "C", "F"). */
  bookingClassLetter?: string;
  sequence?: string;
  legs: number;
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const stripLeadingZeros = (s: string): string => s.replace(/^0+/, "") || s;

/** Cheap guard so we never run the parser on QR codes or random strings. */
export function looksLikeBcbp(raw: string | undefined | null): raw is string {
  return typeof raw === "string" && raw.length >= 58 && raw[0] === "M";
}

export function decodeBcbp(raw: string, now: Date = new Date()): DecodedBcbp | null {
  if (!looksLikeBcbp(raw)) return null;
  const s = raw;

  const legs = parseInt(s[1], 10) || 1;
  const passengerName = clean(s.slice(2, 22));
  const pnr = clean(s.slice(23, 30));
  const fromCode = clean(s.slice(30, 33)).toUpperCase();
  const toCode = clean(s.slice(33, 36)).toUpperCase();
  const carrier = clean(s.slice(36, 39)).toUpperCase();
  const flightNum = stripLeadingZeros(clean(s.slice(39, 44)).replace(/\s/g, ""));
  const julian = clean(s.slice(44, 47));
  const bookingClassLetter = clean(s.slice(47, 48)).toUpperCase();
  const seatNumber = stripLeadingZeros(clean(s.slice(48, 52)).replace(/\s/g, ""));
  const sequence = stripLeadingZeros(clean(s.slice(52, 57)).replace(/\s/g, ""));

  if (!fromCode && !toCode && !flightNum) return null;

  return {
    passengerName: passengerName || undefined,
    pnr: pnr || undefined,
    fromCode: fromCode || undefined,
    toCode: toCode || undefined,
    carrier: carrier || undefined,
    flightNumber: carrier && flightNum ? `${carrier}${flightNum}` : flightNum || undefined,
    date: julianToISO(julian, now),
    seatNumber: seatNumber || undefined,
    bookingClassLetter: bookingClassLetter || undefined,
    sequence: sequence || undefined,
    legs,
  };
}

/**
 * BCBP carries only the Julian day-of-year (001-366) — no year. Resolve to the
 * calendar year whose resulting date is closest to `now`, so a Dec/Jan boundary
 * picks correctly.
 */
function julianToISO(julian: string, now: Date): string | undefined {
  const day = parseInt(julian, 10);
  if (!day || day < 1 || day > 366) return undefined;

  const year = now.getUTCFullYear();
  let best: Date | undefined;
  let bestDiff = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const d = new Date(Date.UTC(y, 0, 1));
    d.setUTCDate(day);
    const diff = Math.abs(d.getTime() - now.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best?.toISOString().slice(0, 10);
}
