import { isValidZone, localDay, toLocal } from "../../../shared/time/zone";
import { dayBarOf, type SectionWindow } from "./sectionGeometry";

/**
 * How a question's section reads in words — on the question's own clock,
 * never the browser's (the time lint holds `shared/time/` as the only door).
 * A zone this runtime does not know reads as UTC rather than as nothing: the
 * card still says when, and the facts say which clock.
 */

type Translate = (key: string, values?: Record<string, unknown>) => string;

const K = "track:inbox.value";

export const zoneOrUtc = (zone: string | null | undefined): string =>
  zone && isValidZone(zone) ? zone : "UTC";

const clockOf = (ms: number, zone: string) => toLocal(ms, zone).local.slice(11, 16);

/** `DD.MM.` of a local `YYYY-MM-DD`. */
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

/** The last instant inside `[from, until)` — the window's end is not part of it. */
const lastInside = (w: SectionWindow) => Math.max(w.fromMs, w.untilMs - 1);

export function sameLocalDay(w: SectionWindow, zone: string): boolean {
  return localDay(w.fromMs, zone) === localDay(lastInside(w), zone);
}

/**
 * The window `[from, until)` in words. The end is exclusive, so a section
 * ending at local midnight ends ON that midnight, not on the day before at
 * its clock (UAT beta.28, D3: "24.09. 00:00 – 26.09. 00:00" beside "3 T 0 h"
 * for a window that ends 27.09. 00:00):
 *   - whole local days (both ends at midnight) read as days, both inclusive:
 *     "24.09. – 26.09.", or one day alone;
 *   - within one day, an end at the next midnight reads "24:00";
 *   - otherwise each end is its own day and clock.
 */
export function formatSpan(w: SectionWindow, zone: string, t: Translate): string {
  const fromDay = localDay(w.fromMs, zone);
  const from = clockOf(w.fromMs, zone);
  const until = clockOf(w.untilMs, zone);
  if (w.untilMs > w.fromMs && from === "00:00" && until === "00:00") {
    const lastDay = localDay(lastInside(w), zone);
    return fromDay === lastDay
      ? t(`${K}.wholeDay`, { day: shortDay(fromDay) })
      : t(`${K}.wholeDays`, { fromDay: shortDay(fromDay), untilDay: shortDay(lastDay) });
  }
  if (sameLocalDay(w, zone)) {
    return t(`${K}.sameDay`, {
      day: shortDay(fromDay),
      from,
      until: until === "00:00" && w.untilMs > w.fromMs ? "24:00" : until,
    });
  }
  return t(`${K}.days`, {
    fromDay: shortDay(fromDay),
    from,
    untilDay: shortDay(localDay(w.untilMs, zone)),
    until,
  });
}

export function formatDuration(ms: number, t: Translate): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return t(`${K}.minutes`, { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t(`${K}.hours`, { h: hours, m: minutes % 60 });
  return t(`${K}.daysHours`, { d: Math.floor(hours / 24), h: hours % 24 });
}

export function formatKm(metres: number | null, locale: string, t: Translate): string {
  if (metres === null) return t(`${K}.none`);
  const km = metres / 1_000;
  const digits = km < 10 ? 1 : 0;
  return t(`${K}.km`, {
    km: new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(km),
  });
}

export function formatSpeed(
  avgKmh: number | null,
  maxKmh: number | null,
  locale: string,
  t: Translate
): string {
  if (avgKmh === null) return t(`${K}.none`);
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  return maxKmh === null
    ? t(`${K}.speedAvg`, { avg: n(avgKmh) })
    : t(`${K}.speed`, { avg: n(avgKmh), max: n(maxKmh) });
}

const minuteOfDay = (ms: number, zone: string) => {
  const hhmm = clockOf(ms, zone);
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
};

/** The day bar's marked share, or null when the window spans more than one local day. */
export function dayBarFor(w: SectionWindow, zone: string): { left: number; width: number } | null {
  if (!sameLocalDay(w, zone)) return null;
  const from = minuteOfDay(w.fromMs, zone);
  const endsAtMidnight = localDay(w.untilMs, zone) !== localDay(w.fromMs, zone);
  return dayBarOf(from, endsAtMidnight ? 1_440 : minuteOfDay(w.untilMs, zone));
}

/** The local days a Track-map link opens for the window, on the profile's clock. */
export function linkDays(
  w: SectionWindow,
  profileZone: string
): { fromDay: string; toDay: string } {
  return { fromDay: localDay(w.fromMs, profileZone), toDay: localDay(lastInside(w), profileZone) };
}
