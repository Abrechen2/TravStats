/**
 * What a stored parse reading says about the bookings a document covers (plan
 * D4, docs/superpowers/specs/2026-11-21-document-links.md) — pure.
 *
 * The payload is JSON written by whichever parser version ran when the
 * document was kept, so it is a boundary: every read is checked and a shape
 * that is not understood yields no evidence, never a guess. Nothing here
 * parses a document again.
 */

export interface DatedNumber {
  /** Upper-case letters and digits only ("LH1790"). */
  number: string;
  /** `YYYY-MM-DD` as printed in the reading, or null. */
  day: string | null;
}

export interface HotelEvidence {
  /** Lower-cased, single-spaced. */
  name: string | null;
  checkIn: string | null;
  checkOut: string | null;
}

export interface DocumentEvidence {
  /** Booking references and PNRs, normalised with `normalizeToken`. */
  references: string[];
  flights: DatedNumber[];
  trains: DatedNumber[];
  /** Bus line names. */
  lines: DatedNumber[];
  hotels: HotelEvidence[];
}

/** A reference shorter than this is noise ("12", "A1"), not a booking code. */
export const MIN_REFERENCE_LENGTH = 5;

export const normalizeToken = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const normalizeName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(isRecord) : [];

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** The `YYYY-MM-DD` a printed date or date-time starts with, or null. */
export function dayOf(v: unknown): string | null {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function emptyEvidence(): DocumentEvidence {
  return { references: [], flights: [], trains: [], lines: [], hotels: [] };
}

function addReference(out: DocumentEvidence, raw: unknown): void {
  const token = text(raw) ? normalizeToken(text(raw)!) : "";
  if (token.length >= MIN_REFERENCE_LENGTH && !out.references.includes(token)) {
    out.references.push(token);
  }
}

function addNumber(into: DatedNumber[], raw: unknown, day: string | null): void {
  const token = text(raw) ? normalizeToken(text(raw)!) : "";
  if (token) into.push({ number: token, day });
}

export function evidenceOf(payload: unknown): DocumentEvidence {
  const out = emptyEvidence();
  if (!isRecord(payload)) return out;
  switch (payload.domain) {
    case "flight":
      for (const f of list(payload.flights)) {
        addNumber(out.flights, f.flightNumber, dayOf(f.departureTime));
        addReference(out, f.bookingReference);
        addReference(out, f.pnr);
      }
      break;
    case "rail":
      for (const b of list(payload.bookings)) {
        addReference(out, b.bookingReference);
        for (const leg of list(b.legs)) {
          addNumber(out.trains, leg.trainNumber, dayOf(leg.departureLocal));
        }
      }
      break;
    case "lodging":
      for (const c of list(payload.candidates)) {
        const stay = isRecord(c.stay) ? c.stay : {};
        const name = text(c.lodgingName) ?? (isRecord(c.lodging) ? text(c.lodging.name) : null);
        addReference(out, stay.bookingReference);
        out.hotels.push({
          name: name ? normalizeName(name) : null,
          checkIn: dayOf(stay.checkIn),
          checkOut: dayOf(stay.checkOut),
        });
      }
      break;
    case "rental":
      for (const c of list(payload.candidates)) addReference(out, c.confirmationNumber);
      break;
    case "bus":
    case "ferry":
      for (const t of list(payload.tickets)) {
        addReference(out, t.bookingReference);
        if (payload.domain === "bus") {
          for (const ride of list(t.rides))
            addNumber(out.lines, ride.lineName, dayOf(ride.departureLocal));
        }
      }
      break;
    case "package":
      if (isRecord(payload.package)) addReference(out, payload.package.bookingReference);
      break;
    default:
      break;
  }
  return out;
}

export const hasEvidence = (e: DocumentEvidence): boolean =>
  e.references.length + e.flights.length + e.trains.length + e.lines.length + e.hotels.length > 0;
