/**
 * An instant that belongs to NO place — a backup, a log line, an invitation's
 * expiry, a recorded track window — on the user's own clock: the profile zone
 * (ADR 0002 Q1; UTC until it is confirmed), never the host's.
 *
 * A time at a place (a departure, a check-in) is never read here: that is the
 * server's `times.*.local`, read through `lib/entityTimes.ts`.
 */
import { todayZoneNow } from "../hooks/useTodayZone";
import { toLocal, type InstantLike } from "../shared/time";

/** `YYYY-MM-DDTHH:mm:ss` on the profile clock, or null for an unusable instant. */
export function profileWallClock(
  instant: InstantLike | null | undefined,
  zone: string = todayZoneNow()
): string | null {
  if (instant === null || instant === undefined || instant === "") return null;
  try {
    return toLocal(instant, zone).local;
  } catch {
    return null;
  }
}

/** `dd.MM.yyyy HH:mm` (with `:ss` when asked) on the profile clock. */
export function profileDateTime(
  instant: InstantLike | null | undefined,
  options: { seconds?: boolean; zone?: string } = {}
): string | null {
  const local = profileWallClock(instant, options.zone);
  if (!local) return null;
  const [y, m, d] = local.slice(0, 10).split("-");
  const clock = local.slice(11, options.seconds ? 19 : 16);
  return `${d}.${m}.${y} ${clock}`;
}

/** Intl formatting of an instant on the profile clock, with `timeZone` always set. */
export function formatInProfileZone(
  instant: InstantLike,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  zone: string = todayZoneNow()
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(date);
}
