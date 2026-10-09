import type { LodgingTemplate } from "../../types";

/**
 * Armani Hotels' own confirmation, "Your Reservation Confirmation at <hotel> -
 * (<number>) - <guest>": English label-value lines. Measured 2026-10-01 on a
 * private mailbox: ten such mails (four direct, six forwarded) read as
 * nothing — the travelclick reader knows the hotel's other, older layout.
 *
 * The name is read from the subject only, and a forward's prefix is the only
 * prefix admitted: the hotel answers questions with "RE:" in the same thread,
 * quoting the confirmation, and a reply is not a second stay.
 *
 * Every label reaches its value with `\s*`, not a tab: a forward puts each
 * value on its own line after a blank one. A date or a number must follow, so
 * the reach cannot land on another label's text.
 */
export const ARMANI: LodgingTemplate = {
  id: "lodging:armani",
  name: "armani",
  match: { markers: ["armani", "confirmation number:"], anchors: ["check-in:"] },
  classify: { type: "hotel" },
  fields: {
    hotelName: {
      patterns: [
        "^(?:(?:WG|FW|Fwd)[ \\t]*:[ \\t]*)*Your Reservation Confirmation at ([^\\n]+?)[ \\t]*-[ \\t]*\\(",
      ],
      transform: "text",
    },
    confirmationNumber: { patterns: ["CONFIRMATION NUMBER:\\s*(\\d+)"] },
    // "Check-In:  Monday, 7 March 2028" — the weekday dropped.
    checkIn: {
      patterns: ["Check-In:\\s*[A-Za-z]+,[ \\t]*(\\d{1,2} [A-Za-z]+ \\d{4})"],
      transform: "englishDate",
    },
    checkOut: {
      patterns: ["Check-Out:\\s*[A-Za-z]+,[ \\t]*(\\d{1,2} [A-Za-z]+ \\d{4})"],
      transform: "englishDate",
    },
    guests: { patterns: ["Guests:\\s*(\\d+)[ \\t]+Adults?"], transform: "integer" },
    roomCategory: {
      patterns: ["Brief description of your Room category[ \\t\\r]*\\n[ \\t]*([^\\r\\n]+)"],
      transform: "text",
    },
    totalPrice: {
      patterns: ["Total cost of stay:\\s*[A-Z]{3}[ \\t]*([\\d.,]+)"],
      transform: "money",
    },
    currency: { patterns: ["Total cost of stay:\\s*([A-Z]{3})"], transform: "currency" },
  },
  required: ["hotelName", "checkIn", "checkOut"],
};
