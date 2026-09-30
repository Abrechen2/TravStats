import { formatLocalClock, formatLocalDate } from "./displayFormat";
import { viewerReading, type TimeValue } from "../shared/time";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "deine Zeit: 17:40" for a place's time, or null when there is nothing to
 * add (owner decision Q2: the place's time is shown; the user's own clock is
 * an optional, secondary hint). The day is named only when it differs.
 */
export function yourTimeText(
  value: TimeValue | null | undefined,
  viewerZone: string | null | undefined,
  t: Translate
): string | null {
  if (!value) return null;
  const reading = viewerReading(value, viewerZone);
  if (!reading) return null;
  const clock = formatLocalClock(reading.local);
  const sameDay = reading.local.slice(0, 10) === value.local.slice(0, 10);
  const time = sameDay ? clock : `${formatLocalDate(reading.local, { omitYear: true })} ${clock}`;
  return t("common:time.yourTime", { time });
}
