import type { LodgingTemplate } from "./types";

/**
 * The built-in lodging readers beyond Booking.com.
 *
 * Each was written against the owner's own corpus and is measured by
 * `scripts/parser-corpus.ts --regex-only`. Before these, ONE template
 * (Booking.com) carried 97 of 108 mails and the other 11 read as nothing on
 * an instance with no LLM — six of them the same campground chain
 * (forgejo#122).
 *
 * These are data, not code, on purpose: they are the first citizens of the
 * lodging half of the template envelope, and they serialise to the JSON the
 * GitHub-synced registry will carry (plan §3). Adding a chain should be a
 * file, not a release.
 *
 * Two rules every entry here keeps:
 *
 *  - `required` is what makes the reader honest. A property name without
 *    dates is not a stay, and proposing one costs the user more attention
 *    than reading nothing would.
 *  - A field the mail does not state is absent, never guessed. KOA writes its
 *    address in a US form this reader does not split into city and postcode,
 *    so it leaves both null rather than inventing a split that would be wrong
 *    in Canada.
 */
export const LODGING_TEMPLATES: readonly LodgingTemplate[] = Object.freeze([
  {
    id: "lodging:koa",
    name: "koa",
    match: {
      markers: ["koa"],
      anchors: ["reservation confirmation", "kampgrounds of america"],
    },
    // A KOA is a campground, and importing one as a hotel is what made every
    // such stay read as a hotel night in the statistics.
    classify: { type: "campsite", chainName: "KOA" },
    fields: {
      // "Canton KOA Holiday Reservation Confirmation #12874330"
      hotelName: { patterns: ["^(.+?)\\s+Reservation Confirmation\\s*#"], transform: "text" },
      confirmationNumber: { patterns: ["Reservation Confirmation\\s*#\\s*(\\d+)"] },
      // "Friday, November 25, 2022 - Saturday, November 26, 2022 (1 Night)"
      checkIn: {
        patterns: ["[A-Za-z]+day,\\s*([A-Za-z]+ \\d{1,2}, \\d{4})\\s*[-–]"],
        transform: "englishDate",
      },
      checkOut: {
        patterns: ["[-–]\\s*[A-Za-z]+day,\\s*([A-Za-z]+ \\d{1,2}, \\d{4})"],
        transform: "englishDate",
      },
      // "Estimated Total For Your Stay*  $47.87 (USD)"
      totalPrice: {
        patterns: ["Estimated Total For Your Stay\\*?\\s*\\t?\\s*[^\\d]*([\\d.,]+)"],
        transform: "money",
      },
      currency: {
        patterns: ["Estimated Total For Your Stay\\*?[^(]*\\(([A-Z]{3})\\)"],
        transform: "currency",
      },
      pricePerNight: { patterns: ["\\$\\s*([\\d.,]+)\\s*/\\s*Night"], transform: "money" },
      // "Your Campsite:\nPull Thru, 50/30/20 Amps, Full Hookups"
      roomCategory: {
        patterns: ["Your Campsite:[ \\t]*\\r?\\n[ \\t]*(.+)"],
        flags: "i",
        transform: "text",
      },
      guests: { patterns: ["(\\d+)\\s+Adults?"], transform: "integer" },
    },
    required: ["hotelName", "checkIn", "checkOut"],
  },
  {
    id: "lodging:hilton",
    name: "hilton",
    match: {
      markers: ["hilton"],
      anchors: ["confirmation #", "your plan information"],
    },
    classify: { type: "hotel", chainName: "Hilton" },
    fields: {
      // The property name is the first body line; the subject carries only
      // the date and the number ("Your 01 Oct 2018 Confirmation #3451920609").
      hotelName: {
        patterns: ["^\\s*((?:Hilton|Conrad|Waldorf|DoubleTree|Hampton|Embassy)[^\\n]*)"],
        flags: "im",
        transform: "text",
      },
      confirmationNumber: { patterns: ["Confirmation\\s*#\\s*(\\d+)"] },
      // "Check In:  Oct 01 3:00 PM" — no year in the body, so it comes from
      // the subject. Without that the stay lands in the import's own year.
      checkIn: {
        patterns: ["Check\\s*In:?\\s*\\t?\\s*([A-Za-z]{3,9}\\.?\\s+\\d{1,2})"],
        transform: "englishDate",
        yearFrom: "subjectYear",
      },
      checkOut: {
        patterns: ["Check\\s*Out:?\\s*\\t?\\s*([A-Za-z]{3,9}\\.?\\s+\\d{1,2})"],
        transform: "englishDate",
        yearFrom: "subjectYear",
      },
      roomCategory: {
        patterns: ["Your Room Information:?\\s*\\t?\\s*([^\\n,]+)"],
        transform: "text",
      },
      totalPrice: { patterns: ["Total for Stay\\s*:?\\s*\\t?\\s*([\\d.,]+)"], transform: "money" },
      currency: {
        patterns: ["Total for Stay\\s*:?\\s*\\t?\\s*[\\d.,]+\\s*([A-Z]{3})"],
        transform: "currency",
      },
      pricePerNight: {
        patterns: ["Rate per\\s*night\\s*:?\\s*\\t?\\s*([\\d.,]+)"],
        transform: "money",
      },
      guests: { patterns: ["Guests:?\\s*\\t?\\s*(\\d+)"], transform: "integer" },
    },
    required: ["hotelName", "checkIn", "checkOut"],
  },
  {
    id: "lodging:travelclick",
    name: "travelclick",
    // The booking engine behind a good many independent hotels — the Armani
    // Dubai confirmations in the corpus are two of them. Matching the ENGINE
    // rather than the brand is the point: one template, every property that
    // uses it.
    match: {
      markers: ["confirmation number"],
      anchors: ["reservations.travelclick.com", "thank you for your reservation at"],
    },
    classify: { type: "hotel" },
    fields: {
      // "Thank you for your reservation at Armani Hotel Dubai! Reference ..."
      hotelName: {
        patterns: ["Thank you for your reservation at\\s+([^!\\n]+)"],
        transform: "text",
      },
      confirmationNumber: { patterns: ["Confirmation number\\s*:?\\s*(\\d+)"] },
      // "Check in\t April 30, 2023" / "Check out\t May 3, 2023"
      checkIn: {
        patterns: ["Check\\s*in\\s*\\t?\\s*([A-Za-z]+ \\d{1,2}, \\d{4})"],
        transform: "englishDate",
      },
      checkOut: {
        patterns: ["Check\\s*out\\s*\\t?\\s*([A-Za-z]+ \\d{1,2}, \\d{4})"],
        transform: "englishDate",
      },
      roomCategory: { patterns: ["You reserved:\\s*([^\\n]+)"], transform: "text" },
      totalPrice: {
        patterns: ["Total amount including all taxes[^:]*:?\\s*\\t?\\s*[A-Z]{3}\\s*([\\d.,]+)"],
        transform: "money",
      },
      currency: {
        patterns: ["Total amount including all taxes[^:]*:?\\s*\\t?\\s*([A-Z]{3})"],
        transform: "currency",
      },
      guests: { patterns: ["Adults\\s*\\t?\\s*(\\d+)"], transform: "integer" },
    },
    required: ["hotelName", "checkIn", "checkOut"],
  },
  {
    id: "lodging:check24",
    name: "check24",
    // A German OTA whose confirmation wears Booking.com's stacked layout and
    // is not one: it says "Buchungsnummer", the label the Booking.com reader
    // deliberately refuses because that is what a hotel's OWN confirmation
    // uses. So it gets its own reader rather than a widened one.
    match: {
      markers: ["check24"],
      anchors: ["buchungsinformationen", "buchungsnummer"],
    },
    // The stop list for every stacked read below. A real confirmation puts a
    // blank line between label and value, so the walk has to step over blank
    // lines — and this is what stops it stepping into the next field.
    labels: [
      "Buchungsnummer",
      "PIN-Code",
      "Anreise",
      "Abreise",
      "Anzahl der Gäste",
      "Zimmername",
      "Zimmerkategorie",
      "Verpflegung",
      "Zahlungsart",
      "Zahlung beim Buchen",
      "Belastung durch",
      "Buchungspreis",
      "Hinweis zu Ihrer Zahlung",
      "Buchungsinformationen",
      "Kontakt zur Unterkunft",
    ],
    classify: { type: "hotel" },
    fields: {
      // Buchungsbestätigung "Novina Sleep Inn Herzogenaurach" (260308233983)
      hotelName: { patterns: ['Buchungsbestätigung\\s*"([^"]+)"'], transform: "text" },
      // Every field below is a LABEL, not a pattern: the value sits on its own
      // line under it, with a blank line in between more often than not, and
      // the engine's walk is the only safe way across that gap.
      confirmationNumber: { stacked: "Buchungsnummer", transform: "digits" },
      // "Di. 10. März 2026 (Check-in: 15:00 - 22:00 Uhr)" — the weekday goes
      // first, and the German date reader takes the rest.
      checkIn: { stacked: "Anreise", dropLeadingWord: true, transform: "germanDate" },
      checkOut: { stacked: "Abreise", dropLeadingWord: true, transform: "germanDate" },
      totalPrice: { stacked: "Buchungspreis", transform: "money" },
      currency: { stacked: "Buchungspreis", transform: "currency" },
      roomCategory: { stacked: "Zimmername", transform: "text" },
      guests: { stacked: "Anzahl der Gäste", transform: "integer" },
      // "60 Erlanger Straße, 91074 Herzogenaurach, Deutschland <https://maps…>"
      address: {
        patterns: ["\\n([^\\n,]+),\\s*\\d{5}\\s+[^,\\n]+,\\s*[A-Za-zÄÖÜäöüß ]+\\s*<"],
        transform: "text",
      },
      postcode: { patterns: [",\\s*(\\d{5})\\s+[^,\\n]+,\\s*[A-Za-zÄÖÜäöüß ]+\\s*<"] },
      city: {
        patterns: [",\\s*\\d{5}\\s+([^,\\n]+),\\s*[A-Za-zÄÖÜäöüß ]+\\s*<"],
        transform: "text",
      },
      country: {
        patterns: [",\\s*\\d{5}\\s+[^,\\n]+,\\s*([A-Za-zÄÖÜäöüß ]+?)\\s*<"],
        transform: "text",
      },
    },
    required: ["hotelName", "checkIn", "checkOut"],
  },
]);
