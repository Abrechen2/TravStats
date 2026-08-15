import type { LodgingPriceStats, LodgingRatingStats } from "./lodging";

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

/** Spread into a `LodgingStats` fixture that has no opinion on money or ratings. */
export const EMPTY_LODGING_STATS_BLOCKS = {
  price: EMPTY_LODGING_PRICE_STATS,
  ratings: EMPTY_LODGING_RATING_STATS,
} as const;
