import type { LodgingImportCandidate } from "../../schemas/lodgingImport";
import type { ParsedLodgingBooking } from "./bookingComTemplate";

/** Join the street with the postcode so the geocoder has a full address line. */
function composeAddress(booking: ParsedLodgingBooking): string | null {
  const parts = [booking.address, booking.postcode].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * A parsed confirmation always yields BOTH a lodging and its stay: the hotel is
 * the place, the confirmation is the visit. `externalRef` on the stay makes a
 * re-upload of the same e-mail a provable no-op; the lodging has no proven id
 * from an e-mail, so it falls back to name+city matching in the preview.
 */
export function bookingsToCandidates(bookings: ParsedLodgingBooking[]): LodgingImportCandidate[] {
  return bookings.map((booking, index) => ({
    sourceRowIndex: index,
    lodging: {
      name: booking.hotelName,
      type: "hotel" as const,
      chainName: null,
      stars: null,
      address: composeAddress(booking),
      city: booking.city,
      country: booking.country,
      lat: null,
      lon: null,
      externalRef: null,
      notes: null,
    },
    lodgingName: booking.hotelName,
    stay: {
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomCategory: booking.roomCategory,
      board: null,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      ratingRoom: null,
      ratingBreakfast: null,
      ratingOverall: null,
      bookingReference: booking.confirmationNumber,
      externalRef: booking.confirmationNumber ? `booking:${booking.confirmationNumber}` : null,
      notes: null,
    },
  }));
}
