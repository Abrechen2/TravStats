/**
 * Rental times are read on the STATION's clock (spec
 * 2026-10-01-rental-domain-design §2, ADR 0002): the server sends each
 * station's wall clock in `times`, and these helpers only dress it.
 */
import { formatTimeValue, type TimeValue } from "../shared/time";

const day = (value: TimeValue): TimeValue => ({ ...value, precision: "day" });

/** "12.05.2027 – 19.05.2027": both days on their stations' calendars. */
export function formatRentalPeriod(
  times: { pickup: TimeValue | null; return: TimeValue | null },
  locale: string
): string {
  if (!times.pickup) return "";
  const from = formatTimeValue(day(times.pickup), locale);
  return times.return ? `${from} – ${formatTimeValue(day(times.return), locale)}` : from;
}

/** Date and time of one end on its station's clock (or the day alone, at day precision). */
export function formatStationMoment(value: TimeValue | null, locale: string): string {
  return value ? formatTimeValue(value, locale) : "";
}
