import { formatTimeValueShown } from "../../lib/displayFormat";
import type { TimeValue } from "../../shared/time";

/**
 * The flights list's date, in one place — shared by `TimeCell` and the narrow
 * row summary in `FlightRow`, so one screen never shows two formats (D-07).
 *
 * It rendered a fixed `YYYY-MM-DD` until 2026-09-18. That came from round-4
 * decision E7, taken when the four logbooks each invented their own format
 * (audit B11) — but a tester reported on 2026-09-17 that the table ignored the
 * format they had chosen in Settings, and the setting solves the same problem
 * better: `YYYY-MM-DD` is one of the three it offers. The day is the
 * departure airport's, from the value's own `local` (ADR 0002).
 */
export const flightDateFmt = (value: TimeValue): string =>
  formatTimeValueShown(value, { dateOnly: true });
