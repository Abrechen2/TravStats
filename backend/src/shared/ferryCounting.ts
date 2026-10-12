/** Ferry crossings (dennis/TravStats forgejo#293). */
import { localDay } from "./time/instant";

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

export interface DatedFerry {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

function terminalDayKey(instant: Date, timezone: string | null): string {
  return localDay(instant, timezone ?? "UTC");
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
