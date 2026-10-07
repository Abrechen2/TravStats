/**
 * Single source of truth for "does this bus ride count, and when".
 *
 * The sibling of `railCounting.ts` (spec 2026-10-07-bus-domain-design §4): every
 * bus figure — the statistics, the cross-domain overview, the evidence behind
 * it — asks here, so no two of them can disagree about which rides are counted.
 * Its own module rather than an alias of rail's, so a later ruling on one
 * domain cannot change the other in silence.
 *
 * One status means the ride happened: `completed`. A ride counts on the
 * calendar of its TERMINALS, not of the reader or of UTC.
 *
 * MIRRORED from `backend/src/shared/busCounting.ts`. Change both together.
 * The one difference: instants arrive as ISO strings here, as the API sends them.
 */

export const COUNTABLE_BUS_STATUSES = ["completed"] as const;

export interface CountableBus {
  status: string;
}

/** The Prisma `where` fragment: `{ userId, ...countableBusWhere() }`. A fresh object per call. */
export function countableBusWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_BUS_STATUSES] } };
}

export function isCountableBus(ride: CountableBus): boolean {
  return (COUNTABLE_BUS_STATUSES as readonly string[]).includes(ride.status);
}

/**
 * `YYYY-MM-DD` of an instant on a terminal's clock. A terminal the server could
 * not place in a zone stored its wall clock as UTC (the spec's abstention), so
 * UTC is then the honest way back.
 */
function terminalDayKey(instant: Date | string, timezone: string | null): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface DatedBus {
  departureTime: Date | string;
  arrivalTime: Date | string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

/**
 * The days a ride was travelled on: the departure day at the departure
 * terminal, and the arrival day at the arrival terminal when that is another
 * day. A ride with no known arrival is a one-day event, not an invented length.
 */
export function busDayKeys(ride: DatedBus): string[] {
  const dep = terminalDayKey(ride.departureTime, ride.depTimezone);
  if (!ride.arrivalTime) return [dep];
  const arr = terminalDayKey(ride.arrivalTime, ride.arrTimezone);
  return arr === dep ? [dep] : [dep, arr];
}

/** The year a ride is filed under: the year it LEFT, on its terminal's calendar. */
export function busYear(ride: DatedBus): number {
  return Number(terminalDayKey(ride.departureTime, ride.depTimezone).slice(0, 4));
}

/** The countries a ride proves: both terminals', when known. Never guessed. */
export function busCountries(ride: {
  depCountry: string | null;
  arrCountry: string | null;
}): string[] {
  const codes = [ride.depCountry, ride.arrCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}
