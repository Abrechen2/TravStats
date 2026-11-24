import type { DomainKey } from "../shared/domains";

/** `GET /stats/years` — mirrors `schemas/statsYears.ts` on the server. */
export interface YearMonth {
  /** 1-12. */
  month: number;
  loggedKm: number | null;
  byDomain: Partial<Record<DomainKey, number>>;
  recordedKm: number | null;
}

export interface YearCardData {
  year: number;
  loggedKm: number | null;
  recordedKm: number | null;
  /** Twelve, January first. */
  months: YearMonth[];
}

export interface YearStats {
  totals: {
    loggedKm: number | null;
    recordedKm: number | null;
    recordedPoints: number | null;
  };
  /** Newest year first. */
  years: YearCardData[];
}
