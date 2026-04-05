import * as cheerio from "cheerio";
import { TRANSFORMS, type AirlineTemplate, type SelectorKey, type TransformName } from "./types";
import type { ParsedBooking } from "../../bookingParser";

const CRITICAL_FIELDS: SelectorKey[] = ["flightNumber", "departureCode", "arrivalCode"];

function applyTransform(transformName: TransformName, value: string): string {
  return TRANSFORMS[transformName](value);
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

/**
 * Try regex patterns from textPatterns against plain text.
 * Returns all non-empty capture groups joined with "T" (for date+time combos), or undefined.
 */
function applyTextPatterns(patterns: string[], text: string): string | undefined {
  for (const pattern of patterns) {
    try {
      const m = text.match(new RegExp(pattern, "im"));
      if (!m) continue;
      // Collect all non-empty capture groups (m[1], m[2], ...)
      const groups: string[] = [];
      for (let i = 1; i < m.length; i++) {
        if (m[i]) groups.push(m[i].trim());
      }
      if (groups.length === 0) continue;
      // Two groups → date+time → join with "T"
      if (groups.length === 2) return `${groups[0]}T${groups[1]}`;
      return groups[0];
    } catch {
      // ignore invalid regex
    }
  }
  return undefined;
}

export function applyTemplate(
  template: AirlineTemplate,
  plainText: string,
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
    const textPats = template.textPatterns?.[sKey];
    if (!selector && !textPats?.length) continue;

    totalFields++;
    let value: string | undefined;

    // Try HTML selector first
    if ($ && selector) {
      const el = $(selector);
      if (el.length > 0) {
        value = el.first().text().trim() || el.first().attr("data-value")?.trim();
      }
    }

    // Fallback to text patterns
    if (!value && textPats?.length && plainText) {
      value = applyTextPatterns(textPats, plainText);
    }

    if (value) {
      const transform = template.transforms[sKey];
      const finalValue = transform ? applyTransform(transform, value) : value;
      (result as unknown as Record<string, unknown>)[bookingKey] = finalValue;
      matchedFields++;
    } else if (CRITICAL_FIELDS.includes(sKey)) {
      result.missing.push(bookingKey as string);
    }
  }

  // Special handling for coPassengers (comma/semicolon-separated list)
  const coPassengersSelector = template.selectors.coPassengers;
  if ($ && coPassengersSelector) {
    const el = $(coPassengersSelector);
    totalFields++;
    if (el.length > 0) {
      const rawText = el.first().text().trim();
      if (rawText) {
        result.coPassengers = rawText.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        matchedFields++;
      }
    }
  }

  result.parserConfidence = totalFields > 0 ? Math.round((matchedFields / totalFields) * 100) : 0;

  if (result.bookingReference) {
    result.pnr = result.bookingReference;
  }

  return result;
}
