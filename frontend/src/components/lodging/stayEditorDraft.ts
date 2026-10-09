import type { BoardType, LodgingCurrency, LodgingStay } from "../../types/lodging";
import type { LodgingDatePrecision } from "../../shared/lodgingTiming";
import { stayCheckIn, stayCheckOut } from "../../lib/entityTimes";

/**
 * The stay editor's draft as plain data - what the dirty guard compares and
 * what the field rules read. The same module serves the `useState` starting
 * values AND the dirty baseline, so an edit form cannot open already
 * "changed" (forgejo#248): if the two were written apart, `nights` as "" in
 * one and null in the other would make every edit ask "discard changes?".
 *
 * Only what the user can SEE and what would be SAVED is in here. An open
 * section or the membership override toggle is UI state, not a change.
 */
export interface StayDraftFields {
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  datePrecision: LodgingDatePrecision;
  nightsText: string;
  isCancelled: boolean;
  roomNumber: string;
  roomCategory: string;
  board: BoardType;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  totalPrice: string;
  currency: LodgingCurrency;
  manualFxRate: string;
  isAwardStay: boolean;
  roomAmenities: string[];
  bookingReference: string;
  membershipId: string;
  membershipOptOut: boolean;
  tripId: string;
  receiptUrl: string | null;
  companionsInput: string;
  notes: string;
}

/** "2026-07-11T00:00:00.000Z" -> "2026-07-11"; null -> "". */
export const toDateInput = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : "";

/**
 * What the form starts with: the stored stay, or - for a NEW stay - nothing
 * but the currency the bill is most likely written in. A new stay deliberately
 * carries NO date, room, booking reference or price (forgejo#227: "stay here
 * again" opens an empty visit to a known house).
 */
export function stayDraftFields(
  stay: LodgingStay | null | undefined,
  defaultCurrency: LodgingCurrency
): StayDraftFields {
  return {
    // The hotel's own days (`times`, ADR 0002) - the same ones the overlap rule
    // and the lists read - and the legacy anchor only where `times` is absent.
    checkIn: (stay && stayCheckIn(stay)?.date) || toDateInput(stay?.checkIn),
    checkOut: (stay && stayCheckOut(stay)?.date) || toDateInput(stay?.checkOut),
    checkInTime: stay?.checkInTime ?? "",
    checkOutTime: stay?.checkOutTime ?? "",
    datePrecision: stay?.datePrecision ?? "DAY",
    nightsText: stay?.nights != null ? String(stay.nights) : "",
    isCancelled: stay?.status === "cancelled",
    roomNumber: stay?.roomNumber ?? "",
    roomCategory: stay?.roomCategory ?? "",
    board: stay?.board ?? "none",
    ratingRoom: stay?.ratingRoom ?? null,
    ratingBreakfast: stay?.ratingBreakfast ?? null,
    ratingService: stay?.ratingService ?? null,
    totalPrice: stay?.totalPrice?.toString() ?? "",
    currency: stay?.currency ?? defaultCurrency,
    manualFxRate:
      stay?.fxSource === "manual" && stay.fxRate !== null && stay.fxRate !== undefined
        ? String(stay.fxRate)
        : "",
    isAwardStay: stay?.isAwardStay ?? false,
    roomAmenities: stay?.roomAmenities ?? [],
    bookingReference: stay?.bookingReference ?? "",
    membershipId: stay?.membershipId ?? "",
    membershipOptOut: stay?.membershipOptOut ?? false,
    tripId: stay?.tripId ?? "",
    receiptUrl: stay?.receiptUrl ?? null,
    companionsInput: (stay?.companions ?? []).join(", "),
    notes: stay?.notes ?? "",
  };
}

export type StayDateErrors = Partial<Record<"checkIn" | "checkOut", string>>;

/**
 * The date rules the server enforces (`backend/src/schemas/lodging.ts`),
 * checked where the user can fix them: an exact stay needs both ends, a month
 * or year stay needs its start, an undated stay needs nothing, and the
 * check-out may not precede the check-in. Returns translation KEYS.
 *
 * "Only exact dates still demand both ends. Every other precision is a
 * statement that the user does NOT have them" - so demanding them would be
 * refusing the very data the precision control was added for.
 */
export function stayDateErrors(fields: {
  datePrecision: LodgingDatePrecision;
  checkIn: string;
  checkOut: string;
}): StayDateErrors {
  const errors: StayDateErrors = {};
  if (fields.datePrecision === "NONE") return errors;
  if (!fields.checkIn) errors.checkIn = "lodging:stayEditor.errors.checkIn";
  if (fields.datePrecision === "DAY") {
    if (!fields.checkOut) errors.checkOut = "lodging:stayEditor.errors.checkOut";
    // ISO calendar days order correctly as text - no Date, no host zone.
    else if (fields.checkIn && fields.checkOut < fields.checkIn) {
      errors.checkOut = "lodging:stayEditor.errors.checkOutBeforeCheckIn";
    }
  }
  return errors;
}
