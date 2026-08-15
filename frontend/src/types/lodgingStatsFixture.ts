import type {
  LodgingGeoStats,
  LodgingLoyaltyStats,
  LodgingPriceStats,
  LodgingRatingStats,
  LodgingRhythmStats,
} from "./lodging";

/**
 * Resting state of the money and quality blocks — what a user with no priced
 * and no rated stay gets back.
 *
 * Exists so a test fixture that cares about nights or spend does not have to
 * spell out two dozen fields it has no opinion about. Every one of those spelt
 * out by hand would also have to be revisited every time a block grows a field,
 * which is exactly the churn that makes people stop adding fields.
 */
export const EMPTY_LODGING_PRICE_STATS: LodgingPriceStats = {
  avgPricePerNight: null,
  medianPricePerNight: null,
  pricedNights: 0,
  pricedStays: 0,
  unpricedStays: 0,
  cheapestNight: null,
  dearestNight: null,
  byYear: [],
  byCountry: [],
  byChain: [],
  byType: [],
  byBoard: [],
  awardNightsValue: null,
};

export const EMPTY_LODGING_RATING_STATS: LodgingRatingStats = {
  avgOverall: null,
  avgRoom: null,
  avgBreakfast: null,
  avgService: null,
  ratedStays: 0,
  unratedStays: 0,
  byChain: [],
  byCountry: [],
  byType: [],
  byStars: [],
  bestValue: [],
};

export const EMPTY_LODGING_GEO_STATS: LodgingGeoStats = {
  continents: [],
  continentsCount: 0,
  northernmost: null,
  southernmost: null,
  centreOfGravity: null,
  topCities: [],
  topCountries: [],
  unlocatedStays: 0,
};

export const EMPTY_LODGING_RHYTHM_STATS: LodgingRhythmStats = {
  nightsAway: 0,
  nightsByWeekday: [0, 0, 0, 0, 0, 0, 0],
  nightsByMonthOfYear: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  nightsBySeason: { winter: 0, spring: 0, summer: 0, autumn: 0 },
  longestStreakNights: 0,
  longestStreak: null,
  longestGapDays: 0,
  awayShareByYear: {},
};

export const EMPTY_LODGING_LOYALTY_STATS: LodgingLoyaltyStats = {
  chainNights: 0,
  independentNights: 0,
  topChain: null,
  topChainShare: null,
  concentration: null,
  chainNightsRanked: [],
  programmeYears: [],
};

/** Spread into a `LodgingStats` fixture that has no opinion on the sub-blocks. */
export const EMPTY_LODGING_STATS_BLOCKS = {
  price: EMPTY_LODGING_PRICE_STATS,
  ratings: EMPTY_LODGING_RATING_STATS,
  geo: EMPTY_LODGING_GEO_STATS,
  rhythm: EMPTY_LODGING_RHYTHM_STATS,
  loyalty: EMPTY_LODGING_LOYALTY_STATS,
} as const;
