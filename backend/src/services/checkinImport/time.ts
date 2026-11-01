/** Timestamp cells of the check-in exports -> `CheckinTime`. */

import type { CheckinTime } from "./types";

const OFFSET = /(?:[+-]\d{2}:?\d{2})$/;
const ZULU = /Z$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * - an offset (`+02:00`) or `Z`: an absolute instant, resolved against the
 *   station's zone once the station is matched;
 * - no offset: the station's wall clock, read as written (the exports print
 *   local time).
 * Returns undefined for an empty cell and null for one that is not a time.
 */
export function timeFromText(raw: unknown): CheckinTime | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  if (text === "") return undefined;
  // Offset or Z: an absolute moment. Its wall clock is the matched station's,
  // and only the station knows its zone — the printed offset can be the
  // user's, not the station's.
  if (ZULU.test(text) || OFFSET.test(text)) {
    const d = new Date(text.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : { instant: d };
  }
  const m = LOCAL.exec(text);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +hh > 23 || +mm > 59) return null;
  return { wall: `${y}-${mo}-${d}T${hh}:${mm}` };
}

/** Epoch seconds (travelynx) -> an instant. */
export function timeFromEpoch(raw: unknown): CheckinTime | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Seconds, unless the value is already milliseconds.
  const d = new Date(n > 1e11 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : { instant: d };
}
