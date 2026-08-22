/**
 * Shapes for the lodging rollup. Split out of index.ts when the money and
 * quality blocks landed — the interfaces alone outgrew a comfortable file.
 *
 * MIRRORED in `frontend/src/types/lodging.ts`. The route serializes
 * `LodgingStats.countries` (a `Set`) to a sorted array on the way out; every
 * other field crosses unchanged.
 */

export interface LodgingStayData {
  lodgingId: string;
  /** Shown next to a superlative ("cheapest night: …"), so the name travels with the stay. */
  lodgingName: string;
  type: string;
  country: string | null;
  city: string | null;
  chainId: number | null;
  /** Chain names, not ids, are what a ranked list has to show. */
  chainName: string | null;
  /** Official star rating of the house (1-5), for the star-vs-your-rating comparison. */
  stars: number | null;
  lat: number | null;
  lon: number | null;
  /** Nullable since 2.7 — see shared/lodgingTiming.ts for what the dates are good for. */
  checkIn: Date | null;
  checkOut: Date | null;
  /** "DAY" | "MONTH" | "YEAR" | "NONE" — how much of the date is actually known. */
  datePrecision: string;
  /** Explicit night count, for when the dates cannot supply one. */
  nights: number | null;
  status: string;
  totalPriceBase: number | null;
  /** The base currency this stay's `totalPriceBase` was snapshotted into — NOT necessarily the user's CURRENT base currency (see spendBaseByCurrency). */
  fxBaseCurrency: string | null;
  currency: string | null;
  totalPrice: number | null;
  board: string | null;
  isAwardStay: boolean;
  ratingOverall: number | null;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  /**
   * The loyalty programme this stay ran under, already resolved — the stored
   * `membershipId` is an OVERRIDE, not the answer (a card attached to a chain
   * covers every stay at that chain). Resolution needs the membership link
   * tables, so it happens in `services/lodging/stayMembership.ts` before the
   * rollup runs; passing those tables in here would make a statistics module a
   * query layer. Null when no card covered the stay.
   */
  programName: string | null;
  /** The card's CURRENT tier, travelling with the name — a status figure without it says half. */
  membershipTier: string | null;
}

/**
 * Minimal shape of a `Lodging` row needed to count hotels the user HAS
 * (including ones with no stay yet) — passed optionally to
 * `calculateLodgingStats` alongside the stays.
 */
export interface LodgingRecord {
  id: string;
  chainId: number | null;
  type: string;
  country: string | null;
  city: string | null;
  /**
   * `false` = the house is only noted down (a saved-places import), not a place
   * the user has been. Excluded from every actual figure — see
   * shared/lodgingCounting.ts.
   */
  visited: boolean;
}

/**
 * One row of a price ranking. `key` is a country code, chain name, lodging
 * type, year or board code depending on which list it appears in.
 *
 * Emitted as sorted ARRAYS rather than keyed records: every screen that wants
 * these wants them ranked, and an array cannot pick up the `Set`-serializes-to-
 * `{}` class of bug that `countries` had to be hand-converted around.
 */
export interface LodgingPriceGroup {
  key: string;
  nights: number;
  totalBase: number;
  /** totalBase / nights, rounded to cents. */
  avgPerNight: number;
}

/** A single stay singled out as a superlative — cheapest or dearest night. */
export interface LodgingPricedNight {
  lodgingId: string;
  lodgingName: string;
  city: string | null;
  country: string | null;
  /** ISO check-in date, or null when the stay carries none. */
  checkIn: string | null;
  nights: number;
  pricePerNight: number;
}

/**
 * Money, all in the user's CURRENT base currency and all from the subset of
 * stays whose FX snapshot matches it — the same slice `spendBaseTotal` sums.
 * A stay converted under an older base currency, or never converted at all,
 * contributes to `unpricedStays` instead of quietly skewing an average.
 */
export interface LodgingPriceStats {
  avgPricePerNight: number | null;
  /** Median over NIGHTS, not over stays: a three-week stay weighs three weeks. */
  medianPricePerNight: number | null;
  /** Nights behind the two figures above. */
  pricedNights: number;
  pricedStays: number;
  /** Stays with a price that could not be compared — no conversion, or an older base currency. */
  unpricedStays: number;
  cheapestNight: LodgingPricedNight | null;
  dearestNight: LodgingPricedNight | null;
  byYear: LodgingPriceGroup[];
  byCountry: LodgingPriceGroup[];
  byChain: LodgingPriceGroup[];
  byType: LodgingPriceGroup[];
  byBoard: LodgingPriceGroup[];
  /**
   * What the award nights were worth: award nights × the average paid rate.
   * Deliberately valued at the AVERAGE PAID night rather than at each stay's
   * own price, because an award stay usually carries no price at all — there
   * is nothing to sum. Null when no paid night exists to derive a rate from.
   */
  awardNightsValue: number | null;
}

/** One row of a rating ranking — chain, country, type, or official star count. */
export interface LodgingRatingGroup {
  key: string;
  stays: number;
  avgOverall: number;
}

/**
 * The user's own verdicts. Every average ignores nulls and reports its own
 * denominator, because "4.2 from three stays" and "4.2 from ninety" are not
 * the same claim.
 */
export interface LodgingRatingStats {
  avgOverall: number | null;
  avgRoom: number | null;
  avgBreakfast: number | null;
  avgService: number | null;
  ratedStays: number;
  unratedStays: number;
  byChain: LodgingRatingGroup[];
  byCountry: LodgingRatingGroup[];
  byType: LodgingRatingGroup[];
  /** Keyed by official star count ("1".."5") — what a category actually delivered. */
  byStars: LodgingRatingGroup[];
  /**
   * Best value: rating points per base-currency unit per night, highest first.
   * Needs BOTH a rating and a comparable price, so it is usually much shorter
   * than the rating lists above.
   */
  bestValue: LodgingValueStay[];
}

export interface LodgingValueStay {
  lodgingId: string;
  lodgingName: string;
  city: string | null;
  country: string | null;
  ratingOverall: number;
  pricePerNight: number;
  /** ratingOverall / pricePerNight — the ranking key, carried so a screen need not re-derive it. */
  valueScore: number;
}

export interface LodgingStats {
  lodgingsCount: number;
  staysCount: number;
  totalNights: number;
  /** Nights allocated to the correct year — see calculateLodgingStats for the walk rule. */
  nightsByYear: Record<string, number>;
  /** "YYYY-MM" — same per-night allocation as nightsByYear. */
  nightsByMonth: Record<string, number>;
  longestStayNights: number;
  chainsUnique: number;
  citiesUnique: number;
  countries: Set<string>;
  countriesCount: number;
  /**
   * Sum of totalPriceBase, but ONLY for stays whose `fxBaseCurrency` matches
   * the CURRENT base currency passed into `calculateLodgingStats` — a stay
   * snapshotted before the user switched their base currency keeps its OLD
   * fxBaseCurrency forever (the snapshot is never recalculated), so it must
   * never be silently added under the new currency's label (finding 2).
   */
  spendBaseTotal: number;
  /** Original amounts grouped by their original currency — not a conversion. */
  spendByCurrency: Record<string, number>;
  /**
   * How many stays carry a price that no provider could convert, and are
   * therefore absent from `spendBaseTotal`.
   *
   * The same rule the stay list uses (`countUnconvertedStays`): a price with
   * no `totalPriceBase` at all. A stay converted under an OLDER base currency
   * is NOT counted here — it has a rate, it is simply reported by
   * `spendBaseByCurrency` instead, and counting it twice would put the same
   * stay behind two different hints.
   *
   * A total that silently omits rows reads exactly like a complete one, which
   * is why this number is computed here rather than left to each screen.
   */
  spendUnconvertedStays: number;
  /** Every totalPriceBase amount grouped by the currency it was snapshotted into — the full picture behind spendBaseTotal's single current-base slice. */
  spendBaseByCurrency: Record<string, number>;
  awardNights: number;
  /**
   * Nights broken down by `Lodging.type` (hotel/campsite/guesthouse/apartment/
   * hostel/…). A plain `Record` rather than named `hotelNights`/`campsiteNights`
   * fields — the vocabulary grows over time (see `LODGING_TYPES` in
   * schemas/lodging.ts) and a fixed field per type would need a matching edit
   * here every time. Keys are whatever `LodgingStayData.type` values are
   * actually present in the input; a type with zero nights has no key at all
   * (never a `0` entry).
   */
  nightsByType: Record<string, number>;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;
  sameHotelRepeatMax: number;
  /**
   * Forward-looking counterparts to `staysCount` / `totalNights` /
   * `lodgingsCount`: everything whose check-out has not happened yet.
   *
   * They are reported SEPARATELY rather than folded in, because a booking for
   * next month is not a night slept (owner rule, 2026-08-15). Keeping them in
   * the same payload is what lets a screen say "plus 3 booked" without a second
   * request — the alternative, leaving them out entirely, made an upcoming stay
   * invisible everywhere except the stay list.
   */
  plannedStaysCount: number;
  plannedNights: number;
  plannedLodgingsCount: number;
  /** Houses the user only bookmarked (`visited === false`). Never part of any other figure. */
  notedLodgingsCount: number;
  /**
   * Nights by the house's OFFICIAL star count ("1".."5"). A house with no star
   * rating has no key here at all — an unrated guesthouse is not a "0-star",
   * and inventing a bucket for it would put campsites next to one-star hotels.
   */
  nightsByStars: Record<string, number>;
  /** Nights by board type. Covers every stay, unlike `price.byBoard` which needs a comparable price. */
  nightsByBoard: Record<string, number>;
  /**
   * Stays rated 5 on ALL FOUR columns. A null on any column disqualifies:
   * "everything was perfect" is a claim about everything, and three fives with
   * a blank is a claim about three things.
   */
  perfectStays: number;
  /** Stays the user rated 2 or worse overall — the ones they got through. */
  enduredStays: number;
  /** Stays of exactly one night. */
  oneNightStays: number;
  /**
   * Stays with no usable date at all (NONE precision). They count in every sum,
   * ranking and achievement — a hotel you cannot date is still one you slept in
   * — and in no calendar series, because a guessed position there would be
   * indistinguishable from a known one (owner rule, 2026-08-16).
   *
   * Reported so a screen can say so. A year chart quietly missing eleven stays
   * looks exactly like a year chart that has them all.
   */
  undatedStays: number;
  /** Nights from those stays. Included in `totalNights`, absent from `nightsByYear`/`nightsByMonth`. */
  undatedNights: number;
  /** Stays whose length nobody knows — neither dates nor an explicit count. */
  staysWithUnknownLength: number;
  price: LodgingPriceStats;
  ratings: LodgingRatingStats;
  geo: LodgingGeoStats;
  rhythm: LodgingRhythmStats;
  loyalty: LodgingLoyaltyStats;
}

/** Nights under one programme in one calendar year — the unit hotel status is counted in. */
export interface LodgingProgrammeYear {
  programme: string;
  /** The card's current tier, not the tier held during that year. */
  tier: string | null;
  year: string;
  nights: number;
  stays: number;
}

/**
 * Brand loyalty and programme status.
 *
 * `topChainShare` and `concentration` are shares of CHAIN nights, not of all
 * nights: "three quarters of your chain nights are with one brand" is a
 * statement about brand choice, while folding in independents would turn it
 * into a statement about how often the user picks a chain at all — which is
 * `chainNights` vs `independentNights`, the figure right next to it.
 */
export interface LodgingLoyaltyStats {
  chainNights: number;
  independentNights: number;
  topChain: { name: string; nights: number } | null;
  /** Share of chain nights at the single most-used brand, 0..1. */
  topChainShare: number | null;
  /** Herfindahl index over chain nights: 1 = one brand only, near 0 = spread thin. */
  concentration: number | null;
  /** Chains by nights, most first. */
  chainNightsRanked: LodgingPlaceCount[];
  /** Newest year first, then most nights — how a programme's own counter reads. */
  programmeYears: LodgingProgrammeYear[];
}

/** A stay singled out for where it was — the northernmost, the southernmost. */
export interface LodgingPlace {
  lodgingId: string;
  lodgingName: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  /** ISO check-in date, or null when the stay carries none. */
  checkIn: string | null;
}

/** One city or country, with how much of the user's sleeping it accounts for. */
export interface LodgingPlaceCount {
  key: string;
  nights: number;
  stays: number;
}

/**
 * Where the nights happened. Coordinates have been on the lodging rows since
 * the geocoding backfill and produced nothing but map pins until now.
 */
export interface LodgingGeoStats {
  /** Sorted names from `utils/continents.ts` — resolved by country, coordinates only as fallback. */
  continents: string[];
  continentsCount: number;
  northernmost: LodgingPlace | null;
  southernmost: LodgingPlace | null;
  /**
   * Nights-weighted mean position, computed on the unit sphere so a traveller
   * either side of the dateline does not get a centre in the Atlantic. Null
   * when no stay has coordinates, or when the weighted vectors cancel out.
   */
  centreOfGravity: { lat: number; lon: number } | null;
  /** Most nights first. Not truncated — a screen slices, a payload should not decide. */
  topCities: LodgingPlaceCount[];
  topCountries: LodgingPlaceCount[];
  /** Stays whose house has no coordinates, and which the coordinate figures therefore omit. */
  unlocatedStays: number;
}

/**
 * When the nights happened. Every figure is derived from the SET of dates away
 * from home, so touching stays form one run and overlapping stays never count
 * a night twice.
 */
export interface LodgingRhythmStats {
  /**
   * Distinct dates spent away. Differs from `totalNights` exactly when stays
   * overlap — and the difference is the interesting part, so both are reported.
   */
  nightsAway: number;
  /**
   * Nights from stays that CAN be placed on a calendar. `nightsAway`
   * deduplicates those same nights, so `walkableNights - nightsAway` is the
   * genuine overlap — nights booked twice.
   *
   * The screen used to compute that overlap as `totalNights - nightsAway`,
   * which is a different quantity: `totalNights` includes undated stays, and
   * those can never enter `nightsAway`. A stay recorded as "July 2011, 5
   * nights" was therefore reported as five nights double-booked. The figure
   * measured missing data and called it an overlap.
   */
  walkableNights: number;
  /** Seven entries, index 0 = Sunday, matching `Date.getUTCDay()`. */
  nightsByWeekday: number[];
  /** Twelve entries, index 0 = January — a histogram across all years, unlike `nightsByMonth`. */
  nightsByMonthOfYear: number[];
  nightsBySeason: Record<"winter" | "spring" | "summer" | "autumn", number>;
  /** Longest unbroken run of nights away. */
  longestStreakNights: number;
  /** ISO dates of that run; null when there are no nights at all. */
  longestStreak: { start: string; end: string } | null;
  /**
   * Longest stretch at home, counted only BETWEEN the first and last night
   * away — before the first recorded night the user was not at home for
   * decades, they simply had no data.
   */
  longestGapDays: number;
  /**
   * Fraction of each year spent away, 0..1. The current year is divided by the
   * days elapsed so far, not by 365, so a January reading is not a collapse.
   */
  awayShareByYear: Record<string, number>;
}
