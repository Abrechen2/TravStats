import type { LodgingTemplate } from "./types";

/** The heading, then image links and blank lines, up to the line with the hotel's NH name. */
const HOTEL_BLOCK = "Hotelinformationen[\\s\\S]{0,600}?\\n[ \\t]*(?=NH )";

/** "Beispielweg 7. D-12345 Musterstadt (Deutschland)" — the address line. */
const ADDRESS_LINE = `${HOTEL_BLOCK}NH [^\\n]*\\n[ \\t]*`;

/**
 * A REPLY ("Re:", "AW:") quotes the whole confirmation — measured: a request
 * to cancel did exactly that — so the body's hotel name is read only from a
 * mail that is not one. The subject's name needs no such guard: its pattern
 * admits only a forward's prefix.
 */
const NOT_A_REPLY = "^(?![ \\t]*(?:re|aw)[ \\t]*:)";

/**
 * NH Hotels' own German confirmations, 2014–2016. Measured 2026-10-01 on a
 * private mailbox: twelve of them, every one read as nothing.
 */
export const NH_HOTELS: LodgingTemplate = {
  id: "lodging:nh",
  name: "nh",
  match: { markers: ["nh-hotels", "check-in:", "check-out:"], anchors: ["reservierungsnummer"] },
  classify: { type: "hotel" },
  fields: {
    hotelName: {
      patterns: [
        "^(?:(?:WG|FW|Fwd)[ \\t]*:[ \\t]*)*Ihre Reservierung für (NH [^,\\n]+),",
        `${NOT_A_REPLY}[\\s\\S]*?${HOTEL_BLOCK}(NH [^\\n]+?)[ \\t\\r]*\\n`,
      ],
      transform: "text",
    },
    confirmationNumber: { patterns: ["Reservierungsnummer:?[ \\t]*([A-Z]{4}\\d{6,})"] },
    // "Check-in: 14/02/2017 - Check-out: 16/02/2017" — day first: the same
    // mail's subject names the arrival as "14. Februar 2017".
    checkIn: {
      patterns: ["Check-in:[ \\t]*(\\d{1,2}/\\d{1,2}/\\d{4})"],
      transform: "slashDayFirstDate",
    },
    checkOut: {
      patterns: ["Check-out:[ \\t]*(\\d{1,2}/\\d{1,2}/\\d{4})"],
      transform: "slashDayFirstDate",
    },
    address: {
      patterns: [`${ADDRESS_LINE}([^\\n]+?)\\.[ \\t]+(?:[A-Z]{1,2}-)?\\d{4,5}[ \\t]`],
      transform: "text",
    },
    postcode: { patterns: [`${ADDRESS_LINE}[^\\n]+?\\.[ \\t]+(?:[A-Z]{1,2}-)?(\\d{4,5})[ \\t]`] },
    city: {
      patterns: [
        `${ADDRESS_LINE}[^\\n]+?\\.[ \\t]+(?:[A-Z]{1,2}-)?\\d{4,5}[ \\t]+([^.(\\n]+?)[ \\t]*[.(]`,
      ],
      transform: "text",
    },
    country: { patterns: [`${ADDRESS_LINE}[^\\n]*\\(([^)\\n]+)\\)`], transform: "text" },
    // "Gesamtpreis Ihres Aufenthaltes / 180.00 EUR + 12.60 MwSt. = / 192.60 EUR"
    totalPrice: {
      patterns: ["Gesamtpreis Ihres Aufenthaltes[\\s\\S]{0,160}?=\\s*([\\d.,]+)\\s*[A-Z]{3}"],
      transform: "money",
    },
    currency: {
      patterns: ["Gesamtpreis Ihres Aufenthaltes[\\s\\S]{0,160}?=\\s*[\\d.,]+\\s*([A-Z]{3})"],
      transform: "currency",
    },
  },
  required: ["hotelName", "checkIn", "checkOut"],
};
