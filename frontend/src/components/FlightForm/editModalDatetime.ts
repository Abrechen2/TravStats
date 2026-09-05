import { formatInTimeZone } from "date-fns-tz";

/** The three pure date helpers of FlightEditModal, moved out so the modal
 *  stays under the 800-line ratchet (`scripts/check-file-size.mjs`). They
 *  carry no state; the contracts below are the modal's, restated here so
 *  the file is readable on its own. */

export interface DateTimeParts {
  date: string;
  time: string;
}

/** Split a UTC instant into separate `YYYY-MM-DD` / `HH:MM` strings in the
 *  BROWSER's local timezone. Used only as the initial seed before the
 *  airport timezones resolve — see the modal's hydration effect, which
 *  re-derives both parts as airport-local from the SAME source instant. */
export function splitLocalDatetime(iso: string | null): DateTimeParts {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Split a UTC instant into separate `YYYY-MM-DD` / `HH:MM` strings in the
 *  given IANA timezone (the departure/arrival airport's zone). Both parts
 *  are derived from the same `Date` + `tz` pair and returned together so a
 *  caller can only ever apply them in a single state update — never as two
 *  independent ones, which is exactly the drift this split guards against. */
export function splitZonedDatetime(iso: string | null, tz: string): DateTimeParts {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: formatInTimeZone(d, tz, "yyyy-MM-dd"),
    time: formatInTimeZone(d, tz, "HH:mm"),
  };
}

/** For a historical flight the date field holds a SHAPE string ("YYYY",
 *  "YYYY-MM" or "YYYY-MM-DD") — the same convention the create form uses,
 *  expanded by buildLocalString on submit. UNKNOWN semantics means the day
 *  was never real (year or year+month precision), so the stored day-01 is
 *  dropped from display; any other semantics keeps the full date, so a
 *  DATE_ONLY flight's known day survives an edit instead of being rewritten
 *  to 01 like the old year+month-only block did. */
export function historicalShapeFor(fullDate: string, semantics?: string): string {
  return semantics === "UNKNOWN" ? fullDate.slice(0, 7) : fullDate;
}
