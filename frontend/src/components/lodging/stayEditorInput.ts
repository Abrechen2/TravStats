import { deadlineWire, type DeadlineDraft } from "../deadlines/deadlineDraft";
import { ratingsPayload } from "./ratingFields";
import { storedRatingsOf } from "../../shared/ratingDerivation";
import type {
  BoardType,
  LodgingCurrency,
  LodgingStay,
  StayInput,
  StayStatus,
} from "../../types/lodging";
import { fromDateInput, splitCsv } from "./stayEditorShared";

/** Everything `buildStayInput` reads: the form's values and what was derived from them. */
export interface StayInputSource {
  stay: LodgingStay | null | undefined;
  datePrecision: StayInput["datePrecision"];
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  parsedNights: number | null;
  effectiveStatus: StayStatus;
  roomNumber: string;
  roomCategory: string;
  board: BoardType;
  derivedPricePerNight: number | null;
  currency: LodgingCurrency;
  parsedTotalPrice: number | null;
  parsedManualFxRate: number | null;
  isAwardStay: boolean;
  ratings: Record<string, number>;
  derivedRatingOverall: number | null;
  roomAmenities: string[];
  bookingReference: string;
  membershipId: string;
  membershipOptOut: boolean;
  receiptUrl: string | null;
  tripId: string;
  companionsInput: string;
  notes: string;
  deadlines: DeadlineDraft;
  initialDeadlines: DeadlineDraft;
}

/** The request body for a create or an update, from the form's values. */
export function buildStayInput(v: StayInputSource): StayInput {
  const {
    stay,
    datePrecision,
    checkIn,
    checkOut,
    checkInTime,
    checkOutTime,
    parsedTotalPrice,
    parsedManualFxRate,
    roomNumber,
    roomCategory,
    board,
    derivedPricePerNight,
    currency,
    isAwardStay,
    ratings,
    derivedRatingOverall,
    roomAmenities,
    bookingReference,
    membershipId,
    membershipOptOut,
    receiptUrl,
    tripId,
    companionsInput,
    notes,
    deadlines,
  } = v;
  return {
    // At NONE precision both dates are cleared outright rather than left
    // as whatever the form last held - a hidden date would be stored and
    // then bucketed as if the user had meant it.
    checkIn: datePrecision === "NONE" ? null : checkIn ? fromDateInput(checkIn) : null,
    checkOut: datePrecision === "DAY" && checkOut ? fromDateInput(checkOut) : null,
    // A time is a claim about a DAY-precise date - anything else clears
    // it, matching the backend's invariant (routes/lodging.ts PATCH).
    checkInTime: datePrecision === "DAY" && checkIn && checkInTime ? checkInTime : null,
    checkOutTime: datePrecision === "DAY" && checkOut && checkOutTime ? checkOutTime : null,
    datePrecision,
    nights: v.parsedNights,
    status: v.effectiveStatus,
    // `null` (not `undefined`) for every clearable field below - an
    // omitted key means "leave it alone" to the backend PATCH handler,
    // while an explicit `null` means "delete this value" (finding 4).
    // `undefined` would be dropped by JSON.stringify and read back as
    // "unchanged", so a user could never clear a field once set.
    roomNumber: roomNumber.trim() || null,
    roomCategory: roomCategory.trim() || null,
    board,
    // Derived, not typed - still PERSISTED, because importers, the stats
    // service and the API all read the stored column; only the way the
    // user supplies it changed.
    pricePerNight: derivedPricePerNight,
    currency,
    totalPrice: Number.isFinite(parsedTotalPrice) ? parsedTotalPrice : null,
    // An emptied field is an explicit null - the user taking their rate
    // back - and must not collapse into "leave it alone".
    manualFxRate: parsedManualFxRate,
    // MUST reach the payload unconditionally (including `false`, to let
    // an edit turn an award stay back off) - without this, the four
    // POINTS_PRO_* achievements (Task 11) are permanently unreachable.
    isAwardStay,
    // A category the stay carried and the user cleared goes as an explicit
    // null; an absent key would mean "leave it alone" to the server.
    ratings: ratingsPayload(stay ? storedRatingsOf(stay) : {}, ratings),
    // Same rule as pricePerNight: computed here, stored as before, so
    // every consumer of `ratingOverall` keeps working unchanged.
    ratingOverall: derivedRatingOverall,
    roomAmenities,
    bookingReference: bookingReference.trim() || null,
    // Only ever the override - never the derived value. Writing the
    // resolved card back would give the rule a second stored copy, which
    // is exactly how the overall-rating derivation drifted out of the
    // import paths (9fcf5de1).
    membershipId: membershipOptOut ? null : membershipId || null,
    membershipOptOut,
    receiptUrl,
    tripId: tripId || null,
    companions: splitCsv(companionsInput),
    notes: notes.trim() || null,
    // Only what changed: an untouched deadline is never rewritten.
    ...deadlineWire(deadlines, v.initialDeadlines),
  };
}
