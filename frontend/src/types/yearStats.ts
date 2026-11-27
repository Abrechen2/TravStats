import type { DomainKey } from "../shared/domains";

/** `GET /stats/years` — mirrors `schemas/statsYears.ts` on the server. */
export interface YearMonth {
  /** 1-12. */
  month: number;
  loggedKm: number | null;
  byDomain: Partial<Record<DomainKey, number>>;
  recordedKm: number | null;
  /** TravTrack's projection still owes these figures (older servers: absent). */
  recordedPending?: boolean;
}

export interface YearCardData {
  year: number;
  loggedKm: number | null;
  recordedKm: number | null;
  /** TravTrack's projection still owes these figures (older servers: absent). */
  recordedPending?: boolean;
  /** Twelve, January first. */
  months: YearMonth[];
  /** Entries and km per purpose, most entries first (older servers: absent). */
  byPurpose?: PurposeShare[];
}

export interface PurposeShare {
  /** `builtin:<key>` | `custom:<uuid>`; null: entries without a purpose. */
  key: string | null;
  count: number;
  km: number | null;
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
