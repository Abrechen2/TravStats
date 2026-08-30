/**
 * The passport, exactly as the server derives it.
 *
 * Nothing here is recomputed on the client. The Companion app builds the same
 * screen from raw endpoints today, and the point of the server-side derivation
 * is that a second copy of the arithmetic cannot disagree with the first.
 */

export type Continent =
  | "Africa"
  | "Antarctica"
  | "Asia"
  | "Europe"
  | "North America"
  | "Oceania"
  | "South America";

export interface PassportCountry {
  /** ISO-3166 alpha-2 — the glyph shown, deliberately not a flag. */
  code: string;
  continent: Continent | null;
  /** Flights that began or ended here. */
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  airports: string[];
  isHome: boolean;
  isNew: boolean;
}

export interface PassportStamp {
  iata: string;
  country: string | null;
  /** ISO date of the first visit. Formatted here, because the month has a language. */
  date: string | null;
}

export interface PassportContinentQuota {
  continent: Continent;
  visited: number;
  total: number;
}

/**
 * One row of the continent band. Several continents may share a row — Africa
 * and Antarctica do — which is why the row is given rather than assumed.
 */
export interface PassportContinentGroup {
  key: string;
  continents: Continent[];
}

export interface Passport {
  summary: {
    countries: number;
    airports: number;
    entries: number;
    /** Real continents, not rows: reaching Antarctica moves this. */
    continentsVisited: number;
    continentsTotal: number;
    firstStampYear: number | null;
    newThisYear: number;
  };
  countries: PassportCountry[];
  continents: PassportContinentQuota[];
  groups: PassportContinentGroup[];
  stamps: PassportStamp[];
}
