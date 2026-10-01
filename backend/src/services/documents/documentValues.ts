import { isCurrencyCode } from "../../shared/currencies";
import { parseAmount } from "../lodging/documentTotal";
import type { ParsedDocumentBody } from "../parsing/parseDocument";
import type { RailTravelClassValue } from "../rail/parser/types";

/**
 * The cost-block values a parser READING holds — price, currency, booking
 * reference, and per leg seat and class. Pure: it reads a parse body and
 * answers, so the live parse (`extractValues.ts`) and the reading already
 * stored on a document (`storedReading.ts`) cannot drift apart on what a
 * reading says.
 */

export type SeatClass = "economy" | "premium_economy" | "business" | "first";

export interface ExtractedValues {
  price: number | null;
  currency: string | null;
  bookingReference: string | null;
  /** Flights only. */
  seatNumber: string | null;
  /** Flights only, mapped onto the four classes a flight stores. */
  seatClass: SeatClass | null;
  /** Rail only (absent for the other domains): the class the ticket states. */
  travelClass?: RailTravelClassValue | null;
  /** Rail only (absent for the other domains), and only for the leg the entry is. */
  coach?: string | null;
}

/** What picks the entry's leg out of a multi-leg booking. */
export interface LegHints {
  /** Picks the leg out of a multi-flight booking. */
  flightNumber?: string;
  /** Picks the leg out of a multi-train booking ("578" or "ICE 578"). */
  trainNumber?: string;
  /** `YYYY-MM-DD`, the same purpose, when the number alone is ambiguous. */
  departureDate?: string;
}

const EMPTY: ExtractedValues = {
  price: null,
  currency: null,
  bookingReference: null,
  seatNumber: null,
  seatClass: null,
};

/** The same mapping the flight review dialog applies to a parsed class. */
export function toSeatClass(raw: string | undefined | null): SeatClass | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("first")) return "first";
  if (lower.includes("business")) return "business";
  if (lower.includes("premium")) return "premium_economy";
  if (lower.includes("economy")) return "economy";
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const currency = (value: unknown): string | null => {
  const code = text(value)?.toUpperCase() ?? null;
  return code !== null && isCurrencyCode(code) ? code : null;
};

const amount = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = typeof value === "string" ? parseAmount(value) : null;
  return parsed !== null && parsed > 0 ? parsed : null;
};

const compact = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/g, "").toUpperCase();

type FlightBody = Extract<ParsedDocumentBody, { domain: "flight" }>;
type ParsedLeg = FlightBody["flights"][number];

/**
 * The leg this entry is. By flight number, then by departure day; with one
 * leg, that leg. Several legs and no match is an abstention for the per-leg
 * fields — the seat of the outbound flight is not the seat of the return.
 */
function pickLeg(legs: ParsedLeg[], input: LegHints): ParsedLeg | null {
  if (legs.length === 1) return legs[0];
  const number = compact(input.flightNumber);
  const byNumber = number ? legs.filter((l) => compact(l.flightNumber) === number) : [];
  const byDay = input.departureDate
    ? (byNumber.length > 0 ? byNumber : legs).filter((l) =>
        (l.departureTime ?? "").startsWith(input.departureDate!)
      )
    : [];
  if (byDay.length === 1) return byDay[0];
  return byNumber.length === 1 ? byNumber[0] : null;
}

/** One value shared by every leg, or null when the legs disagree. */
function shared<T>(legs: ParsedLeg[], read: (leg: ParsedLeg) => T | null): T | null {
  const values = [...new Set(legs.map(read).filter((v): v is T => v !== null))];
  return values.length === 1 ? values[0] : null;
}

function flightValues(body: FlightBody, input: LegHints): ExtractedValues {
  const leg = pickLeg(body.flights, input);
  const booking = (l: ParsedLeg): string | null => text(l.bookingReference) ?? text(l.pnr);
  return {
    price: leg ? amount(leg.price) : shared(body.flights, (l) => amount(l.price)),
    currency: leg ? currency(leg.currency) : shared(body.flights, (l) => currency(l.currency)),
    bookingReference: leg ? booking(leg) : shared(body.flights, booking),
    seatNumber: leg ? text(leg.seat) : null,
    seatClass: leg ? toSeatClass(leg.seatClass) : null,
  };
}

type RailBody = Extract<ParsedDocumentBody, { domain: "rail" }>;
type RailLeg = RailBody["bookings"][number]["legs"][number];

/** The rail leg this entry is: by train number, then by day; with one leg, that leg. */
function pickRailLeg(legs: RailLeg[], input: LegHints): RailLeg | null {
  if (legs.length === 1) return legs[0];
  const wanted = compact(input.trainNumber);
  const byNumber = wanted
    ? legs.filter((l) => {
        const number = compact(l.trainNumber ?? undefined);
        return number !== "" && (wanted === number || wanted.endsWith(number));
      })
    : [];
  const byDay = input.departureDate
    ? (byNumber.length > 0 ? byNumber : legs).filter((l) =>
        l.departureLocal.startsWith(input.departureDate!)
      )
    : [];
  if (byDay.length === 1) return byDay[0];
  return byNumber.length === 1 ? byNumber[0] : null;
}

/**
 * A rail booking's total belongs to the booking, not to one leg; it is
 * offered whichever leg the entry is — the rail parser stores it on the first
 * leg of a connection, and the user decides here where it goes.
 */
function railValues(body: RailBody, input: LegHints): ExtractedValues {
  if (body.bookings.length !== 1) return { ...EMPTY, travelClass: null, coach: null };
  const booking = body.bookings[0];
  const leg = pickRailLeg(booking.legs, input);
  return {
    ...EMPTY,
    price: amount(booking.price),
    currency: currency(booking.currency),
    bookingReference: text(booking.bookingReference),
    travelClass: booking.travelClass,
    seatNumber: leg ? text(leg.seat) : null,
    coach: leg ? text(leg.coach) : null,
  };
}

export function valuesOf(body: ParsedDocumentBody, input: LegHints): ExtractedValues {
  if (body.domain === "flight") return flightValues(body, input);
  if (body.domain === "rail") return railValues(body, input);
  if (body.domain === "rental") {
    const read = body.candidates.length === 1 ? body.candidates[0].input : null;
    if (!read) return EMPTY;
    return {
      ...EMPTY,
      price: amount(read.price),
      currency: currency(read.currency),
      bookingReference: text(read.confirmationNumber),
    };
  }
  // A confirmation for two cruises or two stays names two prices; which one
  // this entry is cannot be told from the document alone.
  if (body.domain === "cruise") {
    if (body.cruises.length !== 1) return EMPTY;
    const cruise = body.cruises[0].input;
    return {
      ...EMPTY,
      price: amount(cruise.price),
      currency: currency(cruise.currency),
      bookingReference: text(cruise.bookingReference),
    };
  }
  if (body.candidates.length !== 1) return EMPTY;
  const stay = body.candidates[0].stay;
  if (!stay) return EMPTY;
  return {
    ...EMPTY,
    price: amount(stay.totalPrice),
    currency: currency(stay.currency),
    bookingReference: text(stay.bookingReference),
  };
}
