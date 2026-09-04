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
 * `transited` is a border crossed on the ground, and `connection` is a change
 * of planes. Only the second is excluded by the default threshold: driving
 * through counts (spec §3.4c).
 *
 * `transited` is REACHABLE only through location history — nothing in a flight,
 * a cruise or a hotel records a road crossing. So it is in this list, because
 * the server can now produce it, but every control that OFFERS it has to check
 * first: on an account with no track evidence it would be a choice that always
 * returns nothing, which reads as a bug rather than as an empty set. See
 * `hasCountryTracks` on the settings payload.
 */
export const COUNTRY_TIERS = ["slept", "visited", "transited", "connection"] as const;
export type CountryTier = (typeof COUNTRY_TIERS)[number];

/**
 * The tier the headline counts from when nobody has chosen one — mirrors
 * `DEFAULT_COUNTRY_TIER` on the server. Only ever a seed for a form control
 * before the server has answered; what actually applies is always the resolved
 * value the API sends (`summary.countryThreshold`, `instanceCountryThreshold`),
 * never this.
 */
export const DEFAULT_COUNTRY_TIER: CountryTier = "transited";

/**
 * The tiers in the order the SETTING offers them: lowest bar first, so the list
 * reads as a rising requirement — everything counts, then a connection does
 * not, then a road crossing does not either, then only a night does.
 *
 * Derived from `COUNTRY_TIERS` rather than written out, so a rung added to the
 * ranking cannot be forgotten here.
 *
 * It is the FULL list. Which of them a given account may be offered is a
 * separate question — see `countryTierChoicesFor`, and §3.4c on why a choice
 * that always returns the same number must not be drawn at all.
 */
export const COUNTRY_TIER_CHOICES: readonly CountryTier[] = [...COUNTRY_TIERS].reverse();

/**
 * The choices this account can meaningfully make.
 *
 * `transited` only exists once a location history has been swept. Offered
 * without one it would sit between `connection` and `visited` producing exactly
 * the same headline as `visited`, which is not an empty set — it is a control
 * that looks broken.
 *
 * A user who ALREADY has the value stored keeps seeing it even without tracks,
 * because a `<select>` whose current value is missing from its options silently
 * shows the wrong one. Their choice is theirs to see and to change.
 */
export function countryTierChoicesFor(
  hasTracks: boolean,
  current: CountryTier | null = null
): readonly CountryTier[] {
  if (hasTracks) return COUNTRY_TIER_CHOICES;
  return COUNTRY_TIER_CHOICES.filter((tier) => tier !== "transited" || current === "transited");
}

/**
 * What KIND of record proved a country. Not how strong — that is the tier.
 *
 * `track` is measured presence: location history reduced to country-days on the
 * server (spec §8), never positions. It is the only kind that names no record
 * the user typed, and the only one that can raise a country nobody logged.
 *
 * It carries an honesty the others do not need. §8.3: the payload cannot say
 * whether a fix was measured by GPS or estimated from a photograph, so nothing
 * drawn from it may imply that it knows. What IS observable — how many points
 * held a day up — travels as a number, and the UI shows the number rather than
 * inventing a word for it.
 */
export type PassportEvidenceKind = "flight" | "lodging" | "port" | "place" | "track";

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
    /** What the rule before evidence tiers would have said — for the one-time notice (§5). */
    legacyCountries: number;
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
  | { kind: "lodging"; date: string | null; lodgingId: string; name: string }
  /**
   * Measured presence — ONE entry for the whole country, not one per day, and
   * the only entry with no record behind it to open. What can be opened is the
   * connection that produced it, which lives in the settings.
   *
   * `points` is raw on purpose (§8.3). Four hundred fixes and one fix are
   * different things and a reader can see that they are; deciding on their
   * behalf that one of them is "estimated" would be the inference-dressed-as-a-
   * measurement this whole design exists to remove.
   */
  | { kind: "track"; date: string | null; days: number; points: number };

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
  /** Distinct days a location history placed the traveller here. Zero on an
   *  account with none, which is most of them. */
  trackDays: number;
  anchor: { iata: string; lat: number; lon: number } | null;
  /** Newest first, undated last. Raw parts, never composed prose. */
  timeline: CountryTimelineEntry[];
  /** True when the timeline was cut, so a client can say it shows the latest N. */
  timelineTruncated: boolean;
}
