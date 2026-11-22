/**
 * One leg from what the barcode and the OCR text say about it.
 *
 * The barcode wins every field it carries (deterministic, error-corrected);
 * the OCR reading fills the rest; the printed clocks (`printedTimes`) turn the
 * barcode's bare date into a departure and arrival. Pure — no I/O — so the
 * merge rules are tested without an image.
 */
import type { ParsedBooking } from "../bookingParser";
import type { DecodedBcbp } from "../../utils/bcbp";
import { getMissingFields } from "../parsers/shared/utils";
import { legTimesOn, readPrintedTimes, type PrintedTimes } from "./printedTimes";

/** The placeholder this codebase reads as "date known, clock not". */
const DATE_ONLY_SUFFIX = "T00:00";

const hasClock = (iso: string | undefined): boolean =>
  typeof iso === "string" && iso.length >= 16 && !iso.endsWith(DATE_ONLY_SUFFIX);

/** Which essential fields a leg still lacks, in the vocabulary of the stages. */
export function openFields(leg: ParsedBooking): string[] {
  const open: string[] = [];
  if (!leg.flightNumber) open.push("flightNumber");
  if (!leg.departureCode) open.push("departureCode");
  if (!leg.arrivalCode) open.push("arrivalCode");
  if (!leg.departureTime) open.push("departureDate");
  if (!hasClock(leg.departureTime)) open.push("departureClock");
  return open;
}

export function needsClock(leg: ParsedBooking): boolean {
  return !hasClock(leg.departureTime);
}

/**
 * The barcode's date with the year the pass PRINTS, when it prints one for
 * the same month. BCBP carries a day of the year only; a 2016 pass decoded in
 * 2026 was proposed as 2026 (and `issueYearDigit` cannot tell 2016 from 2026).
 */
function confirmYear(
  isoDate: string,
  printed: PrintedTimes
): { date: string; yearConfirmed: boolean } {
  const [, m, d] = isoDate.split("-").map(Number);
  const sameDay = printed.dates.find((p) => p.month === m && p.day === d && p.year !== undefined);
  const year = sameDay?.year ?? printed.yearsByMonth.get(m);
  if (year === undefined) return { date: isoDate, yearConfirmed: false };
  return {
    date: `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    yearConfirmed: true,
  };
}

function addInferred(leg: ParsedBooking, field: string): string[] {
  return Array.from(new Set([...(leg.inferredFields ?? []), field]));
}

function removeInferred(leg: ParsedBooking, field: string): string[] | undefined {
  const rest = (leg.inferredFields ?? []).filter((f) => f !== field);
  return rest.length > 0 ? rest : undefined;
}

export function mergeLeg(
  decoded: DecodedBcbp | null,
  ocr: ParsedBooking | undefined,
  ocrText: string | undefined
): ParsedBooking {
  // `airline` is the one field the barcode does NOT win: it carries the two
  // letter code, OCR reads the printed name, and "Lufthansa" is worth more to
  // every caller than "LH".
  let leg: ParsedBooking = {
    ...(ocr ?? { missing: [] }),
    ...(decoded
      ? {
          flightNumber: decoded.flightNumber ?? ocr?.flightNumber,
          departureCode: decoded.fromCode ?? ocr?.departureCode,
          arrivalCode: decoded.toCode ?? ocr?.arrivalCode,
          departureTime: decoded.date ? `${decoded.date}${DATE_ONLY_SUFFIX}` : ocr?.departureTime,
          seat: decoded.seatNumber ?? ocr?.seat,
          pnr: decoded.pnr ?? ocr?.pnr,
          bookingReference: decoded.pnr ?? ocr?.bookingReference,
          bookingClassLetter: decoded.bookingClassLetter ?? ocr?.bookingClassLetter,
          airline: ocr?.airline ?? decoded.carrier,
        }
      : {}),
  };
  if (decoded?.date) {
    // The barcode never carries a year, so its date is a guess until the
    // printed card confirms it.
    leg = { ...leg, inferredFields: addInferred(leg, "departureTime") };
  }

  if (ocrText) leg = applyPrintedTimes(leg, readPrintedTimes(ocrText));

  // Recomputed, not inherited: `missing` came from the OCR pass alone.
  return { ...leg, missing: getMissingFields(leg) };
}

function applyPrintedTimes(leg: ParsedBooking, printed: PrintedTimes): ParsedBooking {
  let next = leg;
  let date = leg.departureTime?.slice(0, 10);
  if (date) {
    const confirmed = confirmYear(date, printed);
    if (confirmed.yearConfirmed) {
      date = confirmed.date;
      next = {
        ...next,
        departureTime: `${date}${next.departureTime!.slice(10)}`,
        inferredFields: removeInferred(next, "departureTime"),
      };
    }
  } else if (printed.date?.year) {
    const { year, month, day } = printed.date;
    date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (!date) return next;

  const clockKnown = hasClock(next.departureTime);
  const times = legTimesOn(date, {
    departure: clockKnown ? next.departureTime!.slice(11, 16) : printed.departure,
    arrival: printed.arrival,
  });
  if (!clockKnown && times.departureTime) next = { ...next, departureTime: times.departureTime };
  if (!next.arrivalTime && times.arrivalTime) {
    next = { ...next, arrivalTime: times.arrivalTime };
    // Without a departure clock the next-day rollover cannot be decided, so
    // the arrival date is the flight date and the user is asked to check it.
    if (!hasClock(next.departureTime)) {
      next = { ...next, inferredFields: addInferred(next, "arrivalTime") };
    }
  }
  return next;
}
