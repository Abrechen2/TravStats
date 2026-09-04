import type { CurrencyCode } from "../shared/currencies";
import type { LodgingDatePrecision } from "../shared/lodgingTiming";
// Frontend view of the `lodging` domain (hotels + campsites). Mirrors
// backend/prisma/schema.prisma (`Lodging`, `LodgingStay`, `LodgingChain`,
// `LodgingMembership`) and backend/src/schemas/lodging.ts (enums + input
// shapes). Kept as hand-mirrored literal unions rather than a cross-package
// import — the frontend build never depends on the backend package, the same
// convention already used for cruise (see types/cruise.ts, CruiseStatus /
// CabinType / the CURRENCIES-mirroring literal union on CruiseInput.currency).
//
// Dates cross the wire as ISO strings, never `Date` objects.

export type LodgingType = "hotel" | "campsite" | "guesthouse" | "apartment" | "hostel";
export type BoardType = "none" | "breakfast" | "half" | "full" | "all_inclusive";
/**
 * `in_progress` ("laufend") joined when lodging status became derived from the
 * dates — a stay whose check-in has passed but whose check-out has not. Mirrors
 * `STAY_STATUSES` in backend/src/schemas/lodging.ts.
 */
export type StayStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
// Any ISO-4217 code — the registry is the single source of truth, mirrored
// from backend/src/shared/currencies.ts. It was four hardcoded codes until
// 2026-08-13, which is why a Dubai booking could not be recorded at all.
export type LodgingCurrency = CurrencyCode;

export interface LodgingChain {
  id: number;
  name: string;
  brandColor: string | null;
  loyaltyProgram: string | null;
  isUserAdded: boolean;
  createdAt: string;
}

/** A chain as it appears on a membership — id + name only, no catalogue detail. */
export interface LodgingChainRef {
  id: number;
  name: string;
}

/** A lodging as it appears on a membership — id + name only, no catalogue detail. */
export interface LodgingRef {
  id: string;
  name: string;
}

export interface LodgingMembership {
  id: string;
  userId: string;
  /** The user's own wording, e.g. "Minor DISCOVERY". Free text, never locked to a catalogue value. */
  programName: string;
  membershipNumber: string | null;
  tier: string | null;
  /** Chains this membership covers, linked by id (see `LodgingMembershipChain` in schema.prisma). */
  chainIds: number[];
  chains: LodgingChainRef[];
  /** Independent hotels this membership covers, linked by id. */
  lodgingIds: string[];
  lodgings: LodgingRef[];
  createdAt: string;
  updatedAt: string;
}

export interface LodgingStay {
  id: string;
  lodgingId: string;
  userId: string;
  tripId: string | null;
  bookingId: string | null;
  /**
   * Nullable since 2.7 — a hotel you remember but cannot date is still a place
   * you slept, and rating/price/board/room/membership all live on the stay.
   * What the dates mean is qualified by `datePrecision`; see
   * `shared/lodgingTiming.ts`, which every consumer asks rather than reading
   * these two directly.
   */
  checkIn: string | null;
  checkOut: string | null;
  /**
   * Optional wall-clock times ("HH:mm") refining the day anchors above —
   * only the "Als Nächstes" countdown consumes them; the dates stay
   * authoritative for everything else. DAY precision only.
   */
  checkInTime: string | null;
  checkOutTime: string | null;
  datePrecision: LodgingDatePrecision;
  /** Explicit night count, for when the dates cannot supply one. */
  nights: number | null;
  status: StayStatus;
  roomNumber: string | null;
  roomCategory: string | null;
  board: BoardType | null;
  pricePerNight: number | null;
  currency: LodgingCurrency;
  totalPrice: number | null;
  /**
   * FX snapshot (spec §7.1), taken at the ECB rate for the check-in day.
   * All four fields are null together whenever the ECB lookup failed for
   * this stay — the save still succeeds, so the UI must render a
   * "no conversion available" state rather than assuming a value exists.
   */
  totalPriceBase: number | null;
  fxRate: number | null;
  fxRateDate: string | null;
  fxBaseCurrency: string | null;
  /** Which provider converted it, null if none did. */
  fxSource: FxRateSource | null;
  isAwardStay: boolean;
  ratingRoom: number | null;
  ratingBreakfast: number | null;
  ratingService: number | null;
  ratingOverall: number | null;
  roomAmenities: string[];
  bookingReference: string | null;
  membershipId: string | null;
  /** true = no programme was used for this stay; false = derive from the hotel. */
  membershipOptOut: boolean;
  receiptUrl: string | null;
  /**
   * How many people the booking covered, as the confirmation stated it. A
   * COUNT, never a name — which is why the editor points at `companions`
   * rather than filling it.
   */
  guests: number | null;
  companions: string[];
  notes: string | null;
  parserTemplate: string | null;
  parserConfidence: number | null;
  dataSource: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A `Lodging` is the *place* (a hotel, reused across visits). `chain` and
 * `stays` are always included by `routes/lodging.ts` (`LODGING_INCLUDE`).
 *
 * `overallRating`, `stayCount`, `nights`, and `totalSpendBase` are NOT
 * Prisma columns — they're computed server-side per request
 * (`computeAggregates` in routes/lodging.ts) and spread onto every
 * lodging returned from list/get/create/update. `totalSpendBase` isn't
 * named in the Task 14 brief, but the real handler always returns it
 * alongside the other three, so it's included here too.
 */
export interface Lodging {
  id: string;
  userId: string;
  type: LodgingType;
  name: string;
  chainId: number | null;
  chain: LodgingChain | null;
  address: string | null;
  city: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, derived from `country`. Null when the text names no country. */
  isoCountryCode: string | null;
  lat: number | null;
  lon: number | null;
  stars: number | null;
  amenities: string[];
  notes: string | null;
  /**
   * Has the user been here, or is the house only noted down? A saved-places
   * import asks once and stores the answer; everything else defaults to true.
   */
  visited: boolean;
  dataSource: string | null;
  createdAt: string;
  updatedAt: string;
  stays: LodgingStay[];
  /** Average of this lodging's stays' ratingOverall (nulls ignored); null when none rated. */
  overallRating: number | null;
  stayCount: number;
  nights: number;
  /**
   * Sum of totalPriceBase across this lodging's stays, but ONLY for the
   * ones whose FX snapshot matches the user's CURRENT base currency — a
   * stay snapshotted before a base-currency switch keeps its OLD currency
   * key in `totalSpendBaseByCurrency` forever and is never silently folded
   * into this total.
   */
  totalSpendBase: number;
  /** Every totalPriceBase amount for this lodging, grouped by the currency it was snapshotted into. */
  totalSpendBaseByCurrency: Record<string, number>;
}

// ---- Input shapes ----
// All fields optional on both types (mirroring CruiseInput's convention) so
// the same interface serves create AND update calls; the backend Zod
// schemas (createLodgingSchema / createStaySchema) enforce the fields that
// are actually required on create (e.g. `name`, `checkIn`/`checkOut`).

export interface LodgingInput {
  type?: LodgingType;
  name?: string;
  chainId?: number | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  stars?: number | null;
  amenities?: string[];
  notes?: string | null;
}

export interface StayInput {
  checkIn?: string | null;
  checkOut?: string | null;
  /** "HH:mm" or null to clear; requires a DAY-precision date on the same end. */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  datePrecision?: LodgingDatePrecision;
  nights?: number | null;
  status?: StayStatus;
  tripId?: string | null;
  bookingId?: string | null;
  roomNumber?: string | null;
  roomCategory?: string | null;
  board?: BoardType;
  pricePerNight?: number | null;
  currency?: LodgingCurrency;
  totalPrice?: number | null;
  /**
   * A rate the USER supplies where no provider has one. Not a stay field: the
   * backend turns it into `fxRate` + `fxSource: "manual"`. An explicit null
   * takes it back; omitted means "leave it alone".
   */
  manualFxRate?: number | null;
  isAwardStay?: boolean;
  ratingRoom?: number | null;
  ratingBreakfast?: number | null;
  ratingService?: number | null;
  ratingOverall?: number | null;
  roomAmenities?: string[];
  bookingReference?: string | null;
  membershipId?: string | null;
  membershipOptOut?: boolean;
  receiptUrl?: string | null;
  guests?: number | null;
  companions?: string[];
  notes?: string | null;
}

/** Chain creation only — there is no update-chain endpoint. `name` is the one required field. */
export interface ChainInput {
  name: string;
  loyaltyProgram?: string;
  brandColor?: string;
}

export interface MembershipInput {
  programName?: string;
  membershipNumber?: string;
  tier?: string;
  /**
   * Chains this membership covers. OMIT to leave the existing links alone; an
   * array replaces them wholesale (`[]` means "covers no chain"), so a PATCH
   * that only fixes a tier cannot unlink anything by accident.
   */
  chainIds?: number[];
  /**
   * Independent hotels this membership covers. Same rule as `chainIds`: OMIT to
   * leave them alone, an array replaces them (`[]` covers no hotel).
   */
  lodgingIds?: string[];
}

/**
 * Shape of `GET /api/v1/lodging/fx-preview` (routes/lodging.ts). A live,
 * read-only rate lookup used ONLY to render the stay editor's FX readout —
 * `null` whenever the ECB lookup fails, matching the same "no partial
 * conversion" contract as the persisted stay's FX snapshot fields. The
 * AUTHORITATIVE snapshot is still computed server-side at save time
 * (`applyFxSnapshot` in routes/lodging.ts) and stored on the stay itself;
 * this preview never feeds back into that write.
 */
export interface FxPreview {
  baseAmount: number;
  rate: number;
  rateDate: string;
  baseCurrency: string;
  /**
   * Which provider answered — `GET /lodging/fx-preview` has always sent it;
   * the type used to drop it, so the editor could not tell an ECB rate from a
   * CDN one and called both "EZB".
   */
  source: FxRateSource;
}

/** The providers a stored or previewed rate can come from. */
export type FxRateSource = "ecb" | "cdn" | "manual";

/**
 * Shape of `GET /api/v1/lodging-chains/:id` (routes/lodgingChains.ts). The
 * membership is found through the LINK table (`LodgingMembershipChain`), not
 * by comparing `chain.loyaltyProgram` to the membership's `programName` —
 * loyalty programmes get rebranded, and that string join broke the moment
 * either side was corrected.
 */
export interface LodgingChainStats {
  hotelCount: number;
  stayCount: number;
  nights: number;
  totalSpendBase: number;
  avgRating: number | null;
}

export interface LodgingChainDetail {
  chain: LodgingChain;
  /** The caller's own lodgings in this chain, with the same derived aggregates as the `/lodging` list. */
  lodgings: Lodging[];
  stats: LodgingChainStats;
  /** The caller's membership LINKED to this chain, if any. */
  membership: LodgingMembership | null;
  /**
   * The other chains this membership covers — taken from the membership when
   * there is one, otherwise from the catalogue suggestion. Excludes this chain.
   */
  siblingChains: LodgingChainRef[];
  /**
   * What the CATALOGUE suggests a membership here should cover: this chain plus
   * every chain seeded with the same `loyaltyProgram`. Pre-ticks the boxes when
   * creating; never consulted afterwards.
   */
  suggestedChains: LodgingChainRef[];
}

export interface LodgingListQuery {
  type?: LodgingType;
  chainId?: number;
  tripId?: string;
  year?: number;
  country?: string;
  limit?: number;
  offset?: number;
  sort?: "nights" | "rating" | "spend" | "name" | "checkIn";
}

/**
 * Shape of `GET /api/v1/stats/lodging` (utils/lodgingStats.ts
 * `calculateLodgingStats`). `countries` is serialized as a sorted array by
 * the route handler — the backend's own `LodgingStats.countries` is a
 * `Set<string>` internally, but a bare `Set` JSON-serializes to `{}`, so the
 * handler converts it before the response leaves the server.
 */
export interface LodgingStats {
  lodgingsCount: number;
  staysCount: number;
  totalNights: number;
  /** Nights allocated to the year they start on. Keys are 4-digit year strings. */
  nightsByYear: Record<string, number>;
  /** Keys are "YYYY-MM". */
  nightsByMonth: Record<string, number>;
  longestStayNights: number;
  chainsUnique: number;
  citiesUnique: number;
  countries: string[];
  countriesCount: number;
  /** Countries of stays that happened, keyed by check-in year (forgejo#80). */
  countriesByYear: Record<string, string[]>;
  /**
   * Sum of totalPriceBase, but ONLY for stays whose FX snapshot matches the
   * user's CURRENT base currency — see `spendBaseByCurrency` for the rest.
   */
  spendBaseTotal: number;
  /** Original amounts grouped by their original currency — not a conversion. */
  spendByCurrency: Record<string, number>;
  /** How many priced stays no provider could convert, and which `spendBaseTotal` therefore leaves out. */
  spendUnconvertedStays: number;
  /** Every totalPriceBase amount grouped by the currency it was snapshotted into — includes the current-base slice that also makes up spendBaseTotal. */
  spendBaseByCurrency: Record<string, number>;
  awardNights: number;
  /** Nights broken down by lodging type (hotel/campsite/guesthouse/apartment/hostel/…). A type with zero nights has no key at all. */
  nightsByType: Record<string, number>;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;
  sameHotelRepeatMax: number;
  /**
   * Forward-looking counterparts to `staysCount` / `totalNights` /
   * `lodgingsCount` — everything whose check-out has not happened yet. Reported
   * separately, never folded in: a booking for next month is not a night slept
   * (owner rule, 2026-08-15; see `shared/lodgingCounting.ts`).
   */
  plannedStaysCount: number;
  plannedNights: number;
  plannedLodgingsCount: number;
  /**
   * Houses that are no visit and have none coming: bookmarked
   * (`visited === false`), or every stay cancelled (owner's decision,
   * 2026-09-02). Never part of any other figure.
   */
  notedLodgingsCount: number;
  /** Nights by the house's OFFICIAL star count ("1".."5"); a house with none has no key. */
  nightsByStars: Record<string, number>;
  /** Nights by board type. Covers every stay, unlike `price.byBoard` which needs a price. */
  nightsByBoard: Record<string, number>;
  /** Stays rated 5 on all four columns; a blank on any of them disqualifies. */
  perfectStays: number;
  /** Stays rated 2 or worse overall — the ones the user got through. */
  enduredStays: number;
  oneNightStays: number;
  /**
   * Stays with no usable date. They count in every sum, ranking and achievement
   * and in no calendar series (owner rule, 2026-08-16). Reported so a screen can
   * say so — a year chart quietly missing eleven stays looks exactly like one
   * that has them all.
   */
  undatedStays: number;
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
 * `chainNights` vs `independentNights`, right next to it.
 */
export interface LodgingLoyaltyStats {
  chainNights: number;
  independentNights: number;
  topChain: { name: string; nights: number } | null;
  /** Share of chain nights at the single most-used brand, 0..1. */
  topChainShare: number | null;
  /** Herfindahl index over chain nights: 1 = one brand only, near 0 = spread thin. */
  concentration: number | null;
  chainNightsRanked: LodgingPlaceCount[];
  /**
   * The same ranking one level down: individual hotels by nights.
   *
   * Optional because an older backend does not send it. A client must tell
   * ABSENT from EMPTY here — treating a missing list as "no completed stay"
   * puts that sentence next to a card reading "longest stay: 3 nights".
   */
  lodgingNightsRanked?: LodgingPlaceCount[];
  /** Newest year first, then most nights. */
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

export interface LodgingGeoStats {
  continents: string[];
  continentsCount: number;
  northernmost: LodgingPlace | null;
  southernmost: LodgingPlace | null;
  /**
   * Nights-weighted mean position, computed on the unit sphere so a traveller
   * either side of the dateline does not get a centre in the Atlantic.
   */
  centreOfGravity: { lat: number; lon: number } | null;
  /** Most nights first, untruncated — the screen slices. */
  topCities: LodgingPlaceCount[];
  topCountries: LodgingPlaceCount[];
  /** Stays whose house has no coordinates, and which the coordinate figures omit. */
  unlocatedStays: number;
}

/**
 * When the nights happened. Derived from the SET of dates away from home, so
 * touching stays form one run and overlapping stays never double-count.
 */
export interface LodgingRhythmStats {
  /** Distinct dates away — differs from `totalNights` exactly when stays overlap. */
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
  /** Twelve entries, index 0 = January — across all years, unlike `nightsByMonth`. */
  nightsByMonthOfYear: number[];
  nightsBySeason: Record<"winter" | "spring" | "summer" | "autumn", number>;
  longestStreakNights: number;
  longestStreak: { start: string; end: string } | null;
  /** Longest stretch at home, counted only between the first and last night away. */
  longestGapDays: number;
  /** Fraction of each year spent away, 0..1; the current year uses days elapsed. */
  awayShareByYear: Record<string, number>;
}

/**
 * One row of a price ranking. `key` is a country code, chain name, lodging
 * type, year or board code depending on which list it appears in.
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
  checkIn: string | null;
  nights: number;
  pricePerNight: number;
}

/**
 * Money, all in the user's CURRENT base currency and all from the subset of
 * stays whose FX snapshot matches it — the same slice `spendBaseTotal` sums.
 * Anything else lands in `unpricedStays` rather than skewing an average.
 */
export interface LodgingPriceStats {
  avgPricePerNight: number | null;
  /** Median over NIGHTS, not over stays: a three-week stay weighs three weeks. */
  medianPricePerNight: number | null;
  pricedNights: number;
  pricedStays: number;
  /** Stays with a price that could not be compared — no conversion, or an older base currency. */
  unpricedStays: number;
  cheapestNight: LodgingPricedNight | null;
  dearestNight: LodgingPricedNight | null;
  /** Oldest year first — read as a trend. */
  byYear: LodgingPriceGroup[];
  /** The rest come back most-nights-first. */
  byCountry: LodgingPriceGroup[];
  byChain: LodgingPriceGroup[];
  byType: LodgingPriceGroup[];
  byBoard: LodgingPriceGroup[];
  /** Award nights valued at the average PAID night rate; null when nothing was ever paid. */
  awardNightsValue: number | null;
}

/** One row of a rating ranking — chain, country, type, or official star count. */
export interface LodgingRatingGroup {
  key: string;
  stays: number;
  avgOverall: number;
}

export interface LodgingValueStay {
  lodgingId: string;
  lodgingName: string;
  city: string | null;
  country: string | null;
  ratingOverall: number;
  pricePerNight: number;
  /** ratingOverall / pricePerNight — the ranking key. */
  valueScore: number;
}

/**
 * The user's own verdicts. Every average ignores nulls and carries its own
 * denominator: "4.2 from three stays" and "4.2 from ninety" are not the same
 * claim, and a screen that cannot tell them apart shows the first as the second.
 */
export interface LodgingRatingStats {
  avgOverall: number | null;
  avgRoom: number | null;
  avgBreakfast: number | null;
  avgService: number | null;
  ratedStays: number;
  unratedStays: number;
  /** Best average first. */
  byChain: LodgingRatingGroup[];
  byCountry: LodgingRatingGroup[];
  byType: LodgingRatingGroup[];
  /** Keyed by official star count ("1".."5"), kept in SCALE order, not ranked. */
  byStars: LodgingRatingGroup[];
  /** Rating points per unit of price per night, best first; at most five. */
  bestValue: LodgingValueStay[];
}
