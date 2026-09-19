/**
 * "vor 3 Stunden" / "3 hours ago", from an ISO timestamp.
 *
 * `Intl.RelativeTimeFormat` rather than a bag of translated strings: the plural
 * rules and the wording are the platform's, in whatever locale is active, and a
 * hand-written German "vor 1 Stunden" is exactly the kind of thing that ships.
 *
 * The unit is the largest one the distance fills, because an inbox row is read
 * at a glance — "vor 2 Tagen" answers the question "is this old?" and
 * "vor 3041 Minuten" does not.
 */
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

export function relativeTimeFromNow(iso: string, locale: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  // An unparseable timestamp is not a reason to break the row it belongs to;
  // the row's point is the username, and the raw string still says something.
  if (Number.isNaN(then)) return iso;

  const diff = then - now.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  // Under a minute: "jetzt" / "now", via the same formatter rather than a
  // string of our own — `numeric: "auto"` is what turns 0 into a word.
  return format.format(0, "minute");
}
