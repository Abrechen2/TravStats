/**
 * How far ahead the next entry is — ONE home for the rule.
 *
 * Glanceable, not precise: days out at range, hours on the last day, "today"
 * inside it. Minute precision would need the departure airport's timezone,
 * which this line does not resolve — and does not need to.
 *
 * Extracted when the entry moved from the domain strip into the map's right
 * column: both surfaces show the same countdown, and a second copy of this
 * arithmetic is a second copy that can drift.
 */
export type NextUpCountdown =
  | { readonly kind: "days"; readonly count: number }
  | { readonly kind: "hours"; readonly count: number }
  | { readonly kind: "today" };

export function nextUpCountdown(startsAt: string, nowMs: number): NextUpCountdown {
  const msAhead = new Date(startsAt).getTime() - nowMs;
  const daysAhead = Math.floor(msAhead / 86_400_000);
  if (daysAhead >= 1) return { kind: "days", count: daysAhead };
  const hoursAhead = Math.floor(msAhead / 3_600_000);
  if (hoursAhead >= 1) return { kind: "hours", count: hoursAhead };
  return { kind: "today" };
}

/** The i18n key + interpolation for a countdown, so both surfaces word it alike. */
export function nextUpCountdownKey(countdown: NextUpCountdown): {
  key: string;
  options?: { count: number };
} {
  switch (countdown.kind) {
    case "days":
      return { key: "dashboard:nextUp.inDays", options: { count: countdown.count } };
    case "hours":
      return { key: "dashboard:nextUp.inHours", options: { count: countdown.count } };
    case "today":
      return { key: "dashboard:nextUp.today" };
  }
}
