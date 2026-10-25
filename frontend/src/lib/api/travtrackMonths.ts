import { api } from "./client";

/**
 * TravTrack's monthly values (TravTrack plan L3): per UTC month the ground
 * kilometres, the countries and — only when the account switched the lookup
 * on — the cities; and that switch.
 */

export type TravTrackCity = { name: string; countryCode: string | null };

export type TravTrackMonth = {
  /** `YYYY-MM`, a UTC month. */
  month: string;
  kmGround: number;
  /** ISO alpha-2 codes. */
  countries: string[];
  /** Null: not determined (the lookup is off, or not finished for the month). */
  cities: TravTrackCity[] | null;
  daysWithData: number;
  daysPaused: number;
};

export type TravTrackMonths = {
  /** Months holding data only — a month without data is absent, never zero. */
  months: TravTrackMonth[];
  /** `YYYY-MM` of months still being recomputed. */
  pending: string[];
};

export const travTrackMonthsApi = {
  months: async (year: number): Promise<TravTrackMonths> =>
    (await api.get<TravTrackMonths>("/travtrack/months", { params: { year: String(year) } })).data,
  cityLookup: async (): Promise<boolean> =>
    (await api.get<{ enabled: boolean }>("/travtrack/city-lookup")).data.enabled,
  setCityLookup: async (enabled: boolean): Promise<boolean> =>
    (await api.put<{ enabled: boolean }>("/travtrack/city-lookup", { enabled })).data.enabled,
};
