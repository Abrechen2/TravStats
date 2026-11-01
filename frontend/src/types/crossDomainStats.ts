/**
 * `GET /stats/cross-domain` (forgejo#399) — MIRRORS
 * `backend/src/schemas/statsCrossDomain.ts`; change both together.
 * A block that cannot be derived is `null`; one whose load failed is also
 * named in `unavailable`.
 */
export interface DayRun {
  days: number;
  from: string;
  to: string;
}
export interface MonthRun {
  months: number;
  from: string;
  to: string;
}
export interface Rhythm {
  days: number;
  bySeason: { winter: number; spring: number; summer: number; autumn: number };
  /** Monday first. */
  byWeekday: number[];
}
export interface UnseenEntry {
  key: string;
  label: string;
  lastVisit: string;
  yearsAgo: number;
}
export interface PhotoTop {
  key: string;
  label: string;
  count: number;
}
export type CrossDomainBlock =
  | "streaks"
  | "rhythm"
  | "timeShift"
  | "unseen"
  | "pricePerKm"
  | "nightsByCountry"
  | "schengen"
  | "photos";

export interface CrossDomainStats {
  asOf: string;
  streaks: {
    activeDays: number;
    longestDayStreak: DayRun | null;
    currentDayStreak: DayRun | null;
    longestMonthStreak: MonthRun | null;
    currentMonthStreak: MonthRun | null;
  } | null;
  rhythm: { overall: Rhythm; byDomain: Record<string, Rhythm> } | null;
  timeShift: {
    flightsMeasured: number;
    unmeasured: number;
    hoursShifted: number;
    biggestJump: {
      flightId: string;
      hours: number;
      from: string | null;
      to: string | null;
      date: string;
    } | null;
    jetLagDays: number;
    jetLagRule: { minHours: number; eastPerHour: number; westPerHour: number };
  } | null;
  unseen: {
    country: UnseenEntry[] | null;
    airport: UnseenEntry[] | null;
    place: UnseenEntry[] | null;
  } | null;
  pricePerKm: {
    blocks: Array<{
      domain: "rail" | "bus" | "ferry";
      currency: string;
      rides: number;
      spend: number;
      km: number | null;
      pricePerKm: number | null;
      ridesWithoutKm: number;
    }>;
    bookedRides: number;
  } | null;
  nightsByCountry: {
    totalNights: number;
    countries: Array<{ country: string; hotel: number; rail: number; bus: number; total: number }>;
    unattributed: { hotel: number; sea: number; rail: number; bus: number; air: number };
  } | null;
  schengen: {
    asOf: string;
    windowDays: number;
    allowedDays: number;
    daysUsed: number;
    daysRemaining: number;
    windowFrom: string;
    lastDayUsed: string | null;
  } | null;
  photos: {
    photos: number;
    withoutDate: number;
    withoutCountry: number;
    busiestDay: { day: string; count: number } | null;
    topTrips: PhotoTop[];
    topCountries: PhotoTop[];
    topPlaces: PhotoTop[];
  } | null;
  unavailable: CrossDomainBlock[];
}
