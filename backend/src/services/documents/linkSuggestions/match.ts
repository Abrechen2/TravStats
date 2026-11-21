import {
  MIN_REFERENCE_LENGTH,
  normalizeName,
  normalizeToken,
  type DatedNumber,
  type DocumentEvidence,
} from "./evidence";
import { contentKey } from "../../tripSuggestions/contentKey";
import type { EntryType } from "../documentFormats";

/**
 * Entry types a document can be proposed for. Place visits never are (owner
 * decision, plan D4): a booking is evidence for a journey, a stay or a rental,
 * not for somewhere the user happened to be.
 */
export const SUGGESTABLE_TYPES = [
  "flight",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "lodgingStay",
  "rentalBooking",
] as const satisfies readonly EntryType[];
export type SuggestableType = (typeof SUGGESTABLE_TYPES)[number];

export type MatchReason =
  "bookingReference" | "flightNumber" | "trainNumber" | "lineName" | "hotelDates" | "dateRange";

/** An entry of a trip, reduced to what the matcher compares. */
export interface EntryFacts {
  type: SuggestableType;
  id: string;
  tripId: string;
  /** Normalised booking reference / confirmation number. */
  reference: string | null;
  /** Flight number, train number or bus line, normalised. */
  number: string | null;
  /** `YYYY-MM-DD` (departure day, pick-up day or check-in). */
  day: string | null;
  checkOut: string | null;
  /** Lodging name, lower-cased. */
  name: string | null;
  /** What names the entry after a re-import. */
  label: string;
}

/** Local print vs UTC storage can disagree by a day; a number match tolerates that. */
const DAY_TOLERANCE = 1;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function sameNumber(a: string, b: string): boolean {
  if (a === b) return true;
  // "ICE 578" on the ticket, "578" on the entry — a bare number names the same train.
  const digits = (s: string) => s.replace(/^[A-Z]+/, "");
  const bare = (s: string) => /^\d+$/.test(s);
  return (bare(a) || bare(b)) && digits(a) === digits(b) && digits(a) !== "";
}

function numberMatches(wanted: readonly DatedNumber[], number: string | null, day: string | null) {
  if (!number) return false;
  return wanted.some(
    (w) =>
      sameNumber(w.number, number) &&
      (w.day === null || day === null || daysApart(w.day, day) <= DAY_TOLERANCE)
  );
}

function namesMatch(a: string, b: string): boolean {
  const [x, y] = [normalizeName(a), normalizeName(b)];
  return x.length >= 4 && y.length >= 4 && (x === y || x.includes(y) || y.includes(x));
}

/** The field that ties `entry` to the document's reading, or null when none does. */
export function matchEntry(evidence: DocumentEvidence, entry: EntryFacts): MatchReason | null {
  if (
    entry.reference &&
    entry.reference.length >= MIN_REFERENCE_LENGTH &&
    evidence.references.includes(normalizeToken(entry.reference))
  ) {
    return "bookingReference";
  }
  switch (entry.type) {
    case "flight":
      return numberMatches(evidence.flights, entry.number, entry.day) ? "flightNumber" : null;
    case "railJourney":
      return numberMatches(evidence.trains, entry.number, entry.day) ? "trainNumber" : null;
    case "busJourney":
      return numberMatches(evidence.lines, entry.number, entry.day) ? "lineName" : null;
    case "lodgingStay":
      for (const hotel of evidence.hotels) {
        if (!hotel.checkIn || !hotel.checkOut) continue;
        if (hotel.checkIn !== entry.day || hotel.checkOut !== entry.checkOut) continue;
        if (!hotel.name) return "dateRange";
        if (entry.name && namesMatch(hotel.name, entry.name)) return "hotelDates";
      }
      return null;
    default:
      return null;
  }
}

/** Survives the entry's deletion and re-import (same idea as the trip-suggestion decisions). */
export const entryContentKey = (entry: EntryFacts): string =>
  contentKey(entry.type, entry.day ?? "", entry.label);
