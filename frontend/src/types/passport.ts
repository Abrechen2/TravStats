/**
 * The passport, exactly as the server derives it.
 *
 * Nothing here is recomputed on the client. The Companion app builds the same
 * screen from raw endpoints today, and the point of the server-side derivation
 * is that a second copy of the arithmetic cannot disagree with the first.
 */

export type Continent =
  "Africa" | "Antarctica" | "Asia" | "Europe" | "North America" | "Oceania" | "South America";

/**
 * How strong the proof behind a country is, strongest first — the vocabulary of
 * `backend/src/shared/countryEvidence.ts`, mirrored and never re-derived.
 *
 * The design plans a fourth rung, `transited` (crossed by road), which nothing
 * in a flight, a cruise or a hotel can record — it becomes observable only with
 * GPS tracks. It is deliberately ABSENT here: a value no record can carry must
 * not appear in a filter or a legend, because a control that always returns
 * nothing reads as a bug rather than as an empty set.
 */
export const COUNTRY_TIERS = ["slept", "visited", "transit"] as const;
export type CountryTier = (typeof COUNTRY_TIERS)[number];

/**
 * The tier the headline counts from when nobody has chosen one — mirrors
 * `DEFAULT_COUNTRY_TIER` on the server. Only ever a seed for a form control
 * before the server has answered; what actually applies is always the resolved
 * value the API sends (`summary.countryThreshold`, `instanceCountryThreshold`),
 * never this.
 */
export const DEFAULT_COUNTRY_TIER: CountryTier = "visited";

/**
 * The same three tiers in the order the SETTING offers them: lowest bar first,
 * so the list reads as a rising requirement — everything counts, then a
 * connection does not, then only a night does.
 *
 * Derived from `COUNTRY_TIERS` rather than written out, so a fourth rung
 * (`transited`, spec §3.4c) cannot appear in the ranking and be forgotten here.
 */
export const COUNTRY_TIER_CHOICES: readonly CountryTier[] = [...COUNTRY_TIERS].reverse();

/** What KIND of record proved a country. Not how strong — that is the tier. */
export type PassportEvidenceKind = "flight" | "lodging" | "port" | "place";

/**
 * How long the traveller was on the ground in a country — spec §3.4b, mirrored
 * from `backend/src/shared/countryEvidence.ts` and never re-derived.
 *
 * THREE states, as a discriminated union, so that an illegal one cannot be
 * represented: there is no way to write a measured value without minutes, and
 * no way to write minutes without claiming they were measured. Flattening this
 * to `minutes: number | null` would put the fabrication back within reach.
 *
 * The two lower states are NOT the same answer with different wording, and the
 * UI must not collapse them into one dash:
 *
 * - `unknown` — a flight touched this country, but no pair of clocks bounds a
 *   spell on the ground. The reader CAN act: record the return leg.
 * - `notApplicable` — no flight touched it at all. A house, a port call and a
 *   place bound no departure, so there is nothing to add.
 *
 * `measured` carries RAW minutes and is formatted, never bucketed: the owner's
 * connection countries run 1.4 h–4.7 h and the next is 25 h, so fixed bins
 * would sit permanently empty and hide the gap, which IS the finding.
 */
export type CountryGroundTime =
  { state: "measured"; minutes: number } | { state: "unknown" } | { state: "notApplicable" };

export interface PassportCountry {
  /** ISO-3166 alpha-2 — the glyph shown, deliberately not a flag. */
  code: string;
  continent: Continent | null;
  /** Flights that began or ended here. Zero for a country proved another way. */
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  airports: string[];
  isHome: boolean;
  isNew: boolean;
  /** The strongest KIND of record behind this country. */
  evidence: PassportEvidenceKind;
  /** How strong that evidence is. */
  tier: CountryTier;
  /** Every kind that contributed, alphabetical. */
  kinds: PassportEvidenceKind[];
  /**
   * At least one contribution carried no date at all. Without this, a country
   * that can never appear in any year's figures looks like a gap in the data
   * rather than a fact about it.
   */
  hasUndatedEvidence: boolean;
  /**
   * How many DISTINCT calendar days any record places the traveller here.
   *
   * DERIVED, never abstained — a plain count, and `0` is an answer rather than
   * a missing one: it means no record named a day, which `hasUndatedEvidence`
   * says in words beside it. Rendering that zero as a dash would claim
   * abstention where the server counted, which is the mirror image of the
   * fabrication the dash exists to prevent.
   */
  daysPresent: number;
  /** The longest measured spell on the ground. See `CountryGroundTime`. */
  groundTime: CountryGroundTime;
  /**
   * Does this country reach the headline? A `false` GREYS the row — it never
   * removes it. The tier is inferred from what was recorded, and what was
   * recorded is incomplete, so a row must stay visible for a reader to correct.
   */
  counted: boolean;
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
    /**
     * THE HEADLINE — countries whose evidence reaches `countryThreshold`.
     * Smaller than `countriesTotal`, and the gap is the point: the list stays
     * complete while the number states a rule.
     */
    countries: number;
    /** Every row in `countries`, whatever its tier. */
    countriesTotal: number;
    /** Which tier the headline counts from. Stated, so nothing has to assume it. */
    countryThreshold: CountryTier;
    /** Flights and airports only — a house proves a country, it adds no airport. */
    airports: number;
    entries: number;
    /** Real continents, not rows: reaching Antarctica moves this. */
    continentsVisited: number;
    continentsTotal: number;
    firstStampYear: number | null;
    newThisYear: number;
    /** Countries per strongest evidence KIND. Sums to `countriesTotal`. */
    byEvidence: Record<PassportEvidenceKind, number>;
    /** Countries per evidence STRENGTH. Also sums to `countriesTotal`. */
    byTier: Record<CountryTier, number>;
  };
  countries: PassportCountry[];
  continents: PassportContinentQuota[];
  groups: PassportContinentGroup[];
  stamps: PassportStamp[];
}

/**
 * The drill-down behind a passport row — GET /stats/countries/:code.
 *
 * This is what makes provenance REACHABLE rather than merely annotated: the
 * passport row says a country was proved by a flight, a port call or a place,
 * and this names the record so the UI can link to the page that edits it.
 *
 * ALL FOUR KINDS ARE HERE since 2026-09-02, the lodging included. It was the
 * one that used to be missing, and its absence was not a detail: a country
 * proved only by a house answered 404, so the single screen the whole design
 * was written for — `Hotel Sport`, geocoded to Bucharest with an address in
 * Slovenia — opened on nothing. Czechia, Italy and Slovenia in the owner's
 * account are that shape.
 *
 * The endpoint still answers 404 when NOTHING evidences a country, and that
 * remains an answer rather than an incident: a house whose only stay is a
 * future booking, and a house whose stays were all cancelled, prove nothing —
 * so neither reaches the passport list either, and the two screens agree.
 */
export type CountryTimelineEntry =
  | {
      kind: "flight";
      date: string | null;
      flightId: string;
      flightNumber: string | null;
      depIata: string | null;
      arrIata: string | null;
      /** The end of the leg that lies inside this country. */
      airportIata: string | null;
    }
  | { kind: "port"; date: string | null; cruiseId: string; portName: string | null }
  | { kind: "place"; date: string | null; placeId: string; name: string }
  | { kind: "lodging"; date: string | null; lodgingId: string; name: string };

export interface CountryAirportUse {
  iata: string;
  visits: number;
  firstDate: string | null;
}

export interface CountryDetail {
  code: string;
  continent: Continent | null;
  evidence: PassportEvidenceKind;
  isHome: boolean;
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  airports: CountryAirportUse[];
  portCalls: number;
  places: number;
  /** Houses in this country whose record proves presence. */
  lodgings: number;
  anchor: { iata: string; lat: number; lon: number } | null;
  /** Newest first, undated last. Raw parts, never composed prose. */
  timeline: CountryTimelineEntry[];
  /** True when the timeline was cut, so a client can say it shows the latest N. */
  timelineTruncated: boolean;
}
