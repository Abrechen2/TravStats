import { formatDayLong } from "../../shared/time";
import { appLocale } from "../../lib/units";

/**
 * Plan days are calendar days (`YYYY-MM-DD`), never instants, so they are
 * formatted at UTC midnight with `timeZone: "UTC"` — the reader's own zone
 * must not move a day. A missing day abstains (`null`) instead of printing
 * an empty or invented date.
 */
const SHORT_DAY: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
const RANGE_DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** `formatRange` is ES2021; the project's `lib` stops at ES2020, every supported browser has it. */
type RangeFormat = Intl.DateTimeFormat & { formatRange(from: Date, to: Date): string };

const atUtc = (day: string) => new Date(`${day}T00:00:00Z`);

/** One plan day in the app's language: "Sa., 24. Okt." / "Sat, Oct 24". */
export function planDay(day: string | null | undefined): string | null {
  return day ? formatDayLong(day, appLocale(), SHORT_DAY) : null;
}

/**
 * A plan's span with the shared month written once ("8.–12. Mai"); the year
 * appears only when the span crosses one. With one end unknown it shows the
 * known end alone.
 */
export function planRange(
  from: string | null | undefined,
  to: string | null | undefined
): string | null {
  if (!from || !to) {
    const only = from || to;
    return only ? formatDayLong(only, appLocale(), RANGE_DAY) : null;
  }
  const crossesYear = from.slice(0, 4) !== to.slice(0, 4);
  const format = new Intl.DateTimeFormat(appLocale(), {
    ...RANGE_DAY,
    ...(crossesYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }) as RangeFormat;
  return format.formatRange(atUtc(from), atUtc(to));
}
