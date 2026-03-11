import * as cheerio from "cheerio";
import type { AirlineTemplate, SelectorKey } from "./types";
import type { ParsedBooking } from "../../bookingParser";

const CRITICAL_FIELDS: SelectorKey[] = ["flightNumber", "departureCode", "arrivalCode"];

function safeTransform(transform: string, value: string): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("value", `return (${transform})(value)`) as (v: string) => string;
    const result = fn(value);
    return typeof result === "string" ? result : value;
  } catch {
    return value;
  }
}

const SELECTOR_TO_BOOKING_KEY: Partial<Record<SelectorKey, keyof ParsedBooking>> = {
  flightNumber: "flightNumber",
  pnr: "bookingReference",
  departureTime: "departureTime",
  arrivalTime: "arrivalTime",
  departureCode: "departureCode",
  arrivalCode: "arrivalCode",
  seat: "seat",
  seatClass: "seatClass",
  price: "price",
  currency: "currency",
  taxes: "taxes",
  fees: "fees",
  baggage: "baggageAllowance",
  frequentFlyer: "frequentFlyerNumber",
  ticketNumber: "ticketNumber",
  bookingClassLetter: "bookingClassLetter",
  terminal: "terminal",
  gate: "gate",
};

export function applyTemplate(
  template: AirlineTemplate,
  _plainText: string,
  htmlContent: string
): ParsedBooking {
  const $ = htmlContent ? cheerio.load(htmlContent) : null;
  const result: ParsedBooking = {
    missing: [],
    parserTemplate: template.iata,
    parserConfidence: 0,
  };

  let matchedFields = 0;
  let totalFields = 0;

  const entries = Object.entries(SELECTOR_TO_BOOKING_KEY) as [SelectorKey, keyof ParsedBooking][];

  for (const [sKey, bookingKey] of entries) {
    const selector = template.selectors[sKey];
    if (!selector) continue;

    totalFields++;
    let value: string | undefined;

    if ($) {
      const el = $(selector);
      if (el.length > 0) {
        value = el.first().text().trim() || el.first().attr("data-value")?.trim();
      }
    }

    if (value) {
      const transform = template.transforms[sKey];
      const finalValue = transform ? safeTransform(transform, value) : value;
      (result as unknown as Record<string, unknown>)[bookingKey] = finalValue;
      matchedFields++;
    } else if (CRITICAL_FIELDS.includes(sKey)) {
      result.missing.push(bookingKey as string);
    }
  }

  result.parserConfidence = totalFields > 0 ? Math.round((matchedFields / totalFields) * 100) : 0;

  if (result.bookingReference) {
    result.pnr = result.bookingReference;
  }

  return result;
}
