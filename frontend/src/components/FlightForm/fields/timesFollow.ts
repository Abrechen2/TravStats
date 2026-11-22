import type { TimesFieldsValue } from "./TimesFields";

/**
 * The arrival date follows the departure date — the one rule every flight
 * form shares, so a scanned or imported flight asks only for the clock.
 *
 * When the departure date changes and the arrival date has not caught up yet
 * (empty, or still before it), the arrival date moves with it. Any other edit
 * passes through untouched — most importantly a plain time edit, and an
 * arrival date the user set on purpose (the next day).
 *
 * Lived inline in `FlightCompleteStep` until the boarding-pass review needed
 * it too (owner, 2026-11-22: "nur die Uhrzeit eintragen").
 */
export function followDepartureDate(
  prev: TimesFieldsValue,
  next: TimesFieldsValue
): TimesFieldsValue {
  const depDateChanged = next.depDate !== prev.depDate;
  const arrivalNeedsToCatchUp = !next.arrDate || next.arrDate < next.depDate;
  return depDateChanged && arrivalNeedsToCatchUp && next.depDate
    ? { ...next, arrDate: next.depDate }
    : next;
}

/**
 * "YYYY-MM-DDTHH:mm" into the four-field shape. With `midnightIsDateOnly`,
 * `T00:00` opens as an EMPTY time to fill in rather than a confident
 * midnight: a boarding pass's barcode carries a day, never a clock. Other
 * sources keep their 00:00 — a real midnight flight must survive the review.
 */
export function splitLocal(
  local: string,
  midnightIsDateOnly = false
): { date: string; time: string } {
  const m = local.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return { date: "", time: "" };
  const time = m[2] ?? "";
  return { date: m[1], time: midnightIsDateOnly && time === "00:00" ? "" : time };
}

/** The four fields back into "YYYY-MM-DDTHH:mm"; empty until both halves are there. */
export function joinLocal(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** The four fields of a parsed flight, arrival date already following departure. */
export function timesFromParsed(
  departure: string,
  arrival: string,
  midnightIsDateOnly = false
): TimesFieldsValue {
  const dep = splitLocal(departure, midnightIsDateOnly);
  const arr = splitLocal(arrival, midnightIsDateOnly);
  return {
    depDate: dep.date,
    depTime: dep.time,
    arrDate: arr.date || dep.date,
    arrTime: arr.time,
  };
}
