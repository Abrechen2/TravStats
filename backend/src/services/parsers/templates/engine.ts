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
        result.coPassengers = rawText
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean);
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

/**
 * Cut a multi-leg mail into its leg blocks.
 *
 * Returns `{ header, blocks }`, or null when the template declares no
 * segments or the text holds fewer than two — a single leg is the plain
 * `applyTemplate` case and must stay byte-identical to what it was.
 */
export function splitSegments(
  template: AirlineTemplate,
  plainText: string
): { header: string; blocks: string[] } | null {
  const segments = template.segments;
  if (!segments?.splitPattern || !plainText) return null;
  let re: RegExp;
  let fence: { start: number; end: number };
  try {
    re = new RegExp(segments.splitPattern, "gim");
    fence = fenceOf(plainText, segments.startAfter, segments.endBefore);
  } catch {
    return null;
  }
  const region = plainText.slice(fence.start, fence.end);
  const starts = [...region.matchAll(re)].map((m) => (m.index ?? 0) + fence.start);
  if (starts.length < 2) return null;
  const header = plainText.slice(0, starts[0]);
  const blocks = starts.map((start, i) =>
    plainText.slice(start, i + 1 < starts.length ? starts[i + 1] : fence.end)
  );
  return { header, blocks };
}

/**
 * Where in the text legs may be looked for. A missing marker means "from the
 * start" / "to the end"; a marker that does not occur is treated the same way
 * rather than yielding an empty region — a fence is a hint about a layout,
 * and a mail that lacks the heading is not thereby leg-less.
 */
function fenceOf(
  text: string,
  startAfter: string | undefined,
  endBefore: string | undefined
): { start: number; end: number } {
  let start = 0;
  if (startAfter) {
    const m = new RegExp(startAfter, "im").exec(text);
    if (m) start = m.index + m[0].length;
  }
  let end = text.length;
  if (endBefore) {
    const m = new RegExp(endBefore, "im").exec(text.slice(start));
    if (m) end = start + m.index;
  }
  return { start, end };
}

/**
 * "13:40 Uhr +1" — the arrival lands the next day. The date+time join in
 * `applyTextPatterns` carries the block's heading date, so a red-eye's arrival
 * would otherwise be stamped on the departure day and last minus ten hours.
 */
const DAY_OFFSET_AFTER_TIME = /(\d{1,2}:\d{2})\s+Uhr\s+\+(\d)\b/g;

export function applyArrivalDayOffset(booking: ParsedBooking, block: string): ParsedBooking {
  const arrival = booking.arrivalTime;
  if (!arrival || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(arrival)) return booking;
  const arrivalClock = arrival.slice(11);
  for (const m of block.matchAll(DAY_OFFSET_AFTER_TIME)) {
    if (m[1].padStart(5, "0") !== arrivalClock) continue;
    const shifted = new Date(`${arrival}:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + Number(m[2]));
    return { ...booking, arrivalTime: shifted.toISOString().slice(0, 16) };
  }
  return booking;
}

/**
 * Every leg a template can read from one mail.
 *
 * One booking per segment where the template declares segments and the mail
 * has them; the single-leg path otherwise. HTML selectors are single-leg by
 * nature (the first element wins), so a segmented mail is read from its text.
 */
export function applyTemplateAll(
  template: AirlineTemplate,
  plainText: string,
  htmlContent: string
): ParsedBooking[] {
  const split = splitSegments(template, plainText);
  if (!split) return [applyTemplate(template, plainText, htmlContent)];
  return split.blocks.map((block) =>
    applyArrivalDayOffset(applyTemplate(template, `${split.header}\n${block}`, ""), block)
  );
}
