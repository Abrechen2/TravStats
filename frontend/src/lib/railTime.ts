/**
 * Rail times are read on the STATION's clock (spec 2026-09-25-rail-domain):
 * the server stores the real instant and the zone it derived from the
 * station's coordinates, and everything the user sees is that zone's wall
 * clock — the time printed on the ticket — never the viewer's own.
 *
 * A null zone (the server could not place the station) means the instant was
 * stored as the wall clock read as UTC, so UTC is the honest way back.
 */

function parts(iso: string, timeZone: string | null): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
  );
}

/** `YYYY-MM-DDTHH:mm` on the station's clock — what a `datetime-local` input takes. */
export function toStationWallClock(iso: string | null, timeZone: string | null): string {
  if (!iso) return "";
  const p = parts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Date and time for display, on the station's clock, in the reader's locale. */
export function formatStationTime(iso: string, timeZone: string | null, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** The clock alone, for the arrival beside a departure on the same row. */
export function formatStationClock(iso: string, timeZone: string | null, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timeZone ?? "UTC",
    timeStyle: "short",
  }).format(new Date(iso));
}
