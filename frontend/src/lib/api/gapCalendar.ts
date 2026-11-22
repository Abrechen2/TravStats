import { api } from "./client";

/**
 * The gap calendar (spec 2026-11-22-gap-calendar): per day of a year, what
 * explains it. Runs are inclusive and cover the whole year.
 */

export const GAP_STATES = [
  "entry",
  "home",
  "track",
  "privacyZone",
  "implausible",
  "unknown",
  "outside",
] as const;
export type GapState = (typeof GAP_STATES)[number];

export type GapRun = { from: string; to: string; state: GapState };

export type GapCalendar = {
  year: number;
  zone: string;
  today: string;
  firstDay: string | null;
  years: number[];
  counts: Record<GapState, number>;
  runs: GapRun[];
};

export const gapCalendarApi = {
  year: async (year: number): Promise<GapCalendar> =>
    (await api.get<GapCalendar>("/gap-calendar", { params: { year: String(year) } })).data,
};
