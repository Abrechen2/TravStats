/**
 * Calendar-day difference between arrival and departure, each expressed in
 * its own airport-local timezone. 0 = same local day, 1 = "+1" overnight,
 * negative when crossing the date line westbound. Missing timezones fall
 * back to UTC so the marker degrades gracefully instead of lying.
 */
export function dayShift(
  depIso: string,
  arrIso: string,
  depTz: string | null | undefined,
  arrTz: string | null | undefined
): number {
  const localDate = (iso: string, tz: string | null | undefined): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date(iso)); // YYYY-MM-DD
  const dep = localDate(depIso, depTz);
  const arr = localDate(arrIso, arrTz);
  return Math.round((Date.parse(arr) - Date.parse(dep)) / 86_400_000);
}
