import type { RailImportBooking, RailTravelClass } from "../../types/rail";

/**
 * The booking-wide facts of a rail import — operator, booking reference,
 * class and total — as the user can correct them before anything is written
 * (forgejo#161). The parse is the starting point, never the last word: a fact
 * the document did not carry starts empty and is marked as not recognised,
 * and nothing is filled in on the reader's behalf.
 */

export const BOOKING_FIELDS = ["operator", "bookingReference", "travelClass", "price"] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];

export interface RailBookingDraft {
  operator: string;
  bookingReference: string;
  travelClass: RailTravelClass | "";
  /** As typed: "59,90", "59.90", "1.084,50". */
  price: string;
  currency: string;
}

/** The limits the server's rail schema holds (`schemas/rail.ts`). */
export const OPERATOR_MAX = 100;
export const BOOKING_REFERENCE_MAX = 40;

export function bookingDraftFrom(booking: RailImportBooking): RailBookingDraft {
  return {
    operator: booking.operator ?? "",
    bookingReference: booking.bookingReference ?? "",
    travelClass: booking.travelClass ?? "",
    price: booking.price === null ? "" : booking.price.toFixed(2).replace(".", ","),
    currency: booking.currency ?? "",
  };
}

/** Which of the four facts the document did not carry. */
export function unreadFields(booking: RailImportBooking): BookingField[] {
  return BOOKING_FIELDS.filter((field) => {
    const value = booking[field];
    return value === null || (typeof value === "string" && value.trim() === "");
  });
}

/**
 * A typed amount as a number. `null` is an empty field (no price — allowed);
 * `undefined` is text that is not an amount, which blocks saving rather than
 * being stored as something else. The last of "." and "," is the decimal
 * separator, the other a thousands mark: "1.084,50" and "1,084.50" agree.
 */
export function parseDraftPrice(text: string): number | null | undefined {
  const compact = text.replace(/\s/g, "");
  if (compact === "") return null;
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimal = lastDot > lastComma ? "." : ",";
  const thousands = decimal === "." ? "," : ".";
  const hasBoth = lastDot >= 0 && lastComma >= 0;
  const normalised = (hasBoth ? compact.split(thousands).join("") : compact).replace(decimal, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return undefined;
  return Number(normalised);
}

const CURRENCY = /^[A-Z]{3}$/;

export type DraftProblem = "price" | "currency";

/** What keeps the draft from being saved — an amount that is not one, or a total without a currency. */
export function draftProblems(draft: RailBookingDraft): DraftProblem[] {
  const price = parseDraftPrice(draft.price);
  const problems: DraftProblem[] = [];
  if (price === undefined) problems.push("price");
  if (price !== null && price !== undefined && !CURRENCY.test(draft.currency.trim())) {
    problems.push("currency");
  }
  return problems;
}

/**
 * Whether a field still holds what the document said. A field the user
 * changed is theirs; the review says so, so what was read and what was
 * typed stay distinguishable.
 */
export function isEdited(
  booking: RailImportBooking,
  draft: RailBookingDraft,
  field: BookingField
): boolean {
  const original = bookingDraftFrom(booking);
  if (field === "price") {
    return parseDraftPrice(draft.price) !== parseDraftPrice(original.price);
  }
  return draft[field].trim() !== original[field].trim();
}

const blankToNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/**
 * The booking as the user confirmed it. Call only on a draft without
 * `draftProblems` — the price is then a number or empty.
 */
export function applyBookingDraft(
  booking: RailImportBooking,
  draft: RailBookingDraft
): RailImportBooking {
  const price = parseDraftPrice(draft.price) ?? null;
  return {
    ...booking,
    operator: blankToNull(draft.operator),
    bookingReference: blankToNull(draft.bookingReference),
    travelClass: draft.travelClass === "" ? null : draft.travelClass,
    price,
    currency: blankToNull(draft.currency.toUpperCase()),
  };
}
