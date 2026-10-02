import type { LodgingTemplate } from "./types";

/** A forward's "WG:", "Fwd:", "AW:" in front of the subject. */
const FORWARD = "^(?:(?:WG|AW|FW|Fwd|RE)[ \\t]*:[ \\t]*)*";

/** "Sonntag, 7. Februar 2016" — the weekday dropped, the rest for `germanDate`. */
const DATE_AFTER = (label: string): string =>
  `${label}:?[ \\t]+[A-Za-zÄÖÜäöü]+,[ \\t]*(\\d{1,2}\\.[ \\t]*[A-Za-zÄÖÜäöü]+[ \\t]+\\d{4})`;

/** The address line under the link to the hotel's Booking.com page (2015+). */
const UNDER_LINK = "booking\\.com/hotel/[^\\n]*\\n[ \\t]*";

/** The two address lines under "Adresse:" (2008–2014). */
const UNDER_ADDRESS = "Adresse:?[ \\t]+[^\\n]*\\n[ \\t]*";

const CURRENCY = "(?:€|£|EUR|CHF|US\\$)";

/**
 * Booking.com confirmations in the ONE-LINE layout, 2008 to 2018:
 * "Anreise <tab> Sonntag, 7. Februar 2016 (nach 15:00)", the property's name
 * only in the subject. The main Booking.com reader (`bookingComTemplate.ts`)
 * reads the stacked layout and declines these; measured 2026-10-01 on a
 * private mailbox, about thirty such confirmations read as nothing.
 *
 * The property's name comes from the SUBJECT, and only from the three subjects
 * a confirmation carries. That is what keeps a change from becoming a second
 * stay: "Ihre aktualisierte Buchung …", "… wurde aktualisiert", "Buchung
 * storniert …" and a property's message carry the same dates in the same
 * layout, and none of them matches, so `required` declines them.
 */
export const BOOKING_COM_LEGACY: LodgingTemplate = {
  id: "lodging:bookingcom-legacy",
  name: "bookingcom-legacy",
  match: { markers: ["booking.com", "anreise", "abreise"], anchors: ["gesamtpreis"] },
  fields: {
    hotelName: {
      patterns: [
        `${FORWARD}Ihre Reservierung im ([^\\n]+)`,
        `${FORWARD}Ihre Buchung in der Unterkunft (?![^\\n]*wurde (?:aktualisiert|storniert|geändert))([^\\n]+)`,
        `${FORWARD}[^\\n]*?Danke! Ihre Buchung ist bestätigt:[ \\t]*([^\\n]+)`,
      ],
      transform: "text",
    },
    checkIn: { patterns: [DATE_AFTER("Anreise")], transform: "germanDate" },
    checkOut: { patterns: [DATE_AFTER("Abreise")], transform: "germanDate" },
    // 2008–2014 print the number; later mails carry it only in their links.
    confirmationNumber: { patterns: ["Buchungsnummer:?[ \\t]+(\\d{6,})", "[?&;]bn=(\\d{6,})"] },
    totalPrice: {
      patterns: [`Gesamtpreis:?[ \\t]+${CURRENCY}[ \\t]*([\\d.,]+)`],
      transform: "money",
    },
    currency: { patterns: [`Gesamtpreis:?[ \\t]+(${CURRENCY})`], transform: "currency" },
    address: {
      patterns: [
        "Adresse:?[ \\t]+([^\\n]+?)[ \\t\\r]*\\n",
        `${UNDER_LINK}([^\\n]+?),[ \\t]*[^,\\n]+,[ \\t]*\\d{4,5},`,
      ],
      transform: "text",
    },
    city: {
      patterns: [
        `${UNDER_ADDRESS}([^,\\n]+),[ \\t]*\\d{4,5}[ \\t\\r]*\\n`,
        `${UNDER_LINK}[^\\n]*?,[ \\t]*([^,\\n]+),[ \\t]*\\d{4,5},`,
      ],
      transform: "text",
    },
    postcode: {
      patterns: [
        `${UNDER_ADDRESS}[^,\\n]+,[ \\t]*(\\d{4,5})[ \\t\\r]*\\n`,
        `${UNDER_LINK}[^\\n]*?,[ \\t]*[^,\\n]+,[ \\t]*(\\d{4,5}),`,
      ],
    },
    country: {
      patterns: [
        `${UNDER_ADDRESS}[^,\\n]+,[ \\t]*\\d{4,5}[ \\t\\r]*\\n[ \\t]*([A-Za-zÄÖÜäöüß ]+?)[ \\t\\r]*\\n`,
        `${UNDER_LINK}[^\\n]*?,[ \\t]*\\d{4,5},[ \\t]*([^,\\n]+?)[ \\t]+-`,
      ],
      transform: "text",
    },
  },
  required: ["hotelName", "checkIn", "checkOut"],
};
