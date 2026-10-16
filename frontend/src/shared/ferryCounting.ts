import { isValidZone, localDay } from "./time";

/** Ferry crossings (dennis/TravStats forgejo#293). */
export const COUNTABLE_FERRY_STATUSES = ["completed"] as const;

export interface CountableFerry {
  status: string;
}

export function countableFerryWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_FERRY_STATUSES] } };
}

export function isCountableFerry(ride: CountableFerry): boolean {
  return (COUNTABLE_FERRY_STATUSES as readonly string[]).includes(ride.status);
}

function terminalDayKey(instant: Date | string, timezone: string | null): string {
  // A zone this runtime's Intl does not know threw a RangeError and took the
  // statistics page down with it; such a ride is read in UTC, the reading the
  // server stores for a place it could not put in a zone.
  return localDay(instant, timezone && isValidZone(timezone) ? timezone : "UTC");
}

export interface DatedFerry {
  departureTime: Date | string;
  arrivalTime: Date | string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

export function ferryDayKeys(ride: DatedFerry): string[] {
  const dep = terminalDayKey(ride.departureTime, ride.depTimezone);
  if (!ride.arrivalTime) return [dep];
  const arr = terminalDayKey(ride.arrivalTime, ride.arrTimezone);
  return arr === dep ? [dep] : [dep, arr];
}

export function ferryYear(ride: DatedFerry): number {
  return Number(terminalDayKey(ride.departureTime, ride.depTimezone).slice(0, 4));
}

export function ferryCountries(ride: {
  depCountry: string | null;
  arrCountry: string | null;
}): string[] {
  const codes = [ride.depCountry, ride.arrCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}
