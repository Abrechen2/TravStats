import { z } from "./zod";

/**
 * The shape of `GET /stats/lodging`.
 *
 * This is the WIRE shape, not `LodgingStats`: the route sorts `countries` into
 * an array on the way out, where the internal type holds a Set. A schema that
 * copied the internal type would describe something no client ever receives.
 *
 * Described once, inferred by the code (forgejo#52). Nearly every field below
 * needed a sentence, and nearly every sentence is about WHAT IS LEFT OUT —
 * which is the part a type cannot carry, and the part a wrong reading turns
 * into a wrong number on screen.
 */

const placeCountSchema = z.object({
  key: z.string(),
  nights: z.number().int(),
  stays: z.number().int(),
});

const priceGroupSchema = z.object({
  key: z.string(),
  nights: z.number().int(),
  totalBase: z.number(),
  avgPerNight: z.number().openapi({ description: "totalBase / nights, rounded to cents." }),
});

const pricedNightSchema = z.object({
  lodgingId: z.string().uuid(),
  lodgingName: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  checkIn: z.string().nullable().openapi({
    description: "ISO check-in date, null when the stay carries none.",
  }),
  nights: z.number().int(),
  pricePerNight: z.number(),
});

const ratingGroupSchema = z.object({
  key: z.string(),
  stays: z.number().int(),
  avgOverall: z.number(),
});

const valueStaySchema = z.object({
  lodgingId: z.string().uuid(),
  lodgingName: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  ratingOverall: z.number(),
  pricePerNight: z.number(),
  valueScore: z.number().openapi({
    description:
      "ratingOverall / pricePerNight — the ranking key, carried so a screen need " +
      "not re-derive it.",
  }),
});

const lodgingPlaceSchema = z.object({
  lodgingId: z.string().uuid(),
  lodgingName: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  checkIn: z.string().nullable(),
});

export const lodgingPriceStatsSchema = z
  .object({
    avgPricePerNight: z.number().nullable(),
    medianPricePerNight: z.number().nullable().openapi({
      description: "Median over NIGHTS, not over stays: a three-week stay weighs three weeks.",
    }),
    pricedNights: z.number().int(),
    pricedStays: z.number().int(),
    unpricedStays: z
      .number()
      .int()
      .openapi({
        description:
          "Stays with a price that could not be compared — no conversion, or an older " +
          "base currency. Counted here rather than quietly skewing an average.",
      }),
    cheapestNight: pricedNightSchema.nullable(),
    dearestNight: pricedNightSchema.nullable(),
    byYear: z.array(priceGroupSchema),
    byCountry: z.array(priceGroupSchema),
    byChain: z.array(priceGroupSchema),
    byType: z.array(priceGroupSchema),
    byBoard: z.array(priceGroupSchema),
    awardNightsValue: z
      .number()
      .nullable()
      .openapi({
        description:
          "Award nights times the AVERAGE PAID rate, deliberately not each stay's own " +
          "price: an award stay usually carries no price at all, so there is nothing " +
          "to sum. Null when no paid night exists to derive a rate from.",
      }),
  })
  .openapi({
    description:
      "All money in the user's CURRENT base currency, from the subset of stays whose " +
      "FX snapshot matches it — the same slice `spendBaseTotal` sums.",
  });

export const lodgingRatingStatsSchema = z.object({
  avgOverall: z.number().nullable(),
  avgRoom: z.number().nullable(),
  avgBreakfast: z.number().nullable(),
  avgService: z.number().nullable(),
  ratedStays: z.number().int(),
  unratedStays: z.number().int(),
  byChain: z.array(ratingGroupSchema),
  byCountry: z.array(ratingGroupSchema),
  byType: z.array(ratingGroupSchema),
  byStars: z.array(ratingGroupSchema).openapi({
    description: "Keyed by OFFICIAL star count — what a category actually delivered.",
  }),
  bestValue: z.array(valueStaySchema).openapi({
    description:
      "Rating points per base-currency unit per night, highest first. Needs BOTH a " +
      "rating and a comparable price, so it is usually much shorter than the rating " +
      "lists above.",
  }),
});

export const lodgingGeoStatsSchema = z.object({
  continents: z.array(z.string()).openapi({
    description: "Resolved by country; coordinates only as a fallback.",
  }),
  continentsCount: z.number().int(),
  northernmost: lodgingPlaceSchema.nullable(),
  southernmost: lodgingPlaceSchema.nullable(),
  centreOfGravity: z
    .object({ lat: z.number(), lon: z.number() })
    .nullable()
    .openapi({
      description:
        "Nights-weighted mean position, computed on the unit sphere so a traveller " +
        "either side of the dateline does not get a centre in the Atlantic. Null when " +
        "no stay has coordinates, or when the weighted vectors cancel out.",
    }),
  topCities: z.array(placeCountSchema).openapi({
    description: "Most nights first. NOT truncated — a screen slices, a payload should not decide.",
  }),
  topCountries: z.array(placeCountSchema),
  unlocatedStays: z.number().int().openapi({
    description: "Stays whose house has no coordinates, which every figure above therefore omits.",
  }),
});

export const lodgingRhythmStatsSchema = z.object({
  nightsAway: z
    .number()
    .int()
    .openapi({
      description:
        "Distinct dates spent away. Differs from `totalNights` exactly when stays " +
        "overlap — and the difference is the interesting part, so both are reported.",
    }),
  walkableNights: z
    .number()
    .int()
    .openapi({
      description:
        "Nights from stays that CAN be placed on a calendar, so `walkableNights` minus " +
        "`nightsAway` is the genuine overlap. Computing it from `totalNights` instead is " +
        "a different quantity: totalNights includes undated stays, which can never enter " +
        "nightsAway, so a stay recorded as five nights in July 2011 came out as five " +
        "nights double-booked. That measured missing data and called it an overlap.",
    }),
  nightsByWeekday: z.array(z.number().int()).openapi({
    description: "Seven entries, index 0 = Sunday, matching Date.getUTCDay().",
  }),
  nightsByMonthOfYear: z.array(z.number().int()).openapi({
    description: "Twelve entries, index 0 = January — a histogram across all years.",
  }),
  nightsBySeason: z.object({
    winter: z.number().int(),
    spring: z.number().int(),
    summer: z.number().int(),
    autumn: z.number().int(),
  }),
  longestStreakNights: z.number().int(),
  longestStreak: z.object({ start: z.string(), end: z.string() }).nullable(),
  longestGapDays: z
    .number()
    .int()
    .openapi({
      description:
        "Longest stretch at home, counted only BETWEEN the first and last night away — " +
        "before the first recorded night the user was not at home for decades, they " +
        "simply had no data.",
    }),
  awayShareByYear: z.record(z.string(), z.number()).openapi({
    description:
      "Fraction of each year spent away, 0..1. The current year is divided by the days " +
      "elapsed so far, not by 365, so a January reading is not a collapse.",
  }),
});

export const lodgingLoyaltyStatsSchema = z.object({
  chainNights: z.number().int(),
  independentNights: z.number().int(),
  topChain: z.object({ name: z.string(), nights: z.number().int() }).nullable(),
  topChainShare: z.number().nullable().openapi({
    description: "Share of chain nights at the single most-used brand, 0..1.",
  }),
  concentration: z.number().nullable().openapi({
    description: "Herfindahl index over chain nights: 1 = one brand only, near 0 = spread thin.",
  }),
  chainNightsRanked: z.array(placeCountSchema),
  lodgingNightsRanked: z.array(placeCountSchema).openapi({
    description:
      "The same ranking one level down: individual HOUSES by nights. `key` is the " +
      "lodging's name, and two hotels sharing a name in different cities are two rows, " +
      "because they are two hotels.",
  }),
  programmeYears: z
    .array(
      z.object({
        programme: z.string(),
        tier: z.string().nullable().openapi({
          description: "The card's CURRENT tier, not the tier held during that year.",
        }),
        year: z.string(),
        nights: z.number().int(),
        stays: z.number().int(),
      })
    )
    .openapi({
      description: "Newest year first, then most nights — how a programme's own counter reads.",
    }),
});

export const lodgingStatsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.object({
      lodgingsCount: z.number().int(),
      staysCount: z.number().int(),
      totalNights: z.number().int(),
      nightsByYear: z.record(z.string(), z.number().int()),
      nightsByMonth: z.record(z.string(), z.number().int()),
      longestStayNights: z.number().int(),
      chainsUnique: z.number().int(),
      citiesUnique: z.number().int(),
      countries: z.array(z.string()).openapi({
        description: "Sorted on the way out — a Set internally, an array on the wire.",
      }),
      countriesCount: z.number().int(),
      countriesByYear: z.record(z.string(), z.array(z.string())).openapi({
        description:
          "Keyed by CHECK-IN year. An undated stay is in `countries` and in no year, " +
          "like an undated flight. Until this index existed the overview's single-year " +
          "tile fell back to the LIFETIME set under a year header.",
      }),
      spendBaseTotal: z.number().openapi({
        description:
          "Sum of totalPriceBase, but ONLY for stays whose fxBaseCurrency matches the " +
          "CURRENT base currency. A stay snapshotted before the user switched keeps its " +
          "OLD currency forever — the snapshot is never recalculated — so adding it " +
          "under the new label would be a wrong number, not a rounding.",
      }),
      spendByCurrency: z.record(z.string(), z.number()).openapi({
        description: "Original amounts grouped by their original currency — NOT a conversion.",
      }),
      spendUnconvertedStays: z
        .number()
        .int()
        .openapi({
          description:
            "Stays whose price no provider could convert, and which are therefore absent " +
            "from spendBaseTotal. A stay converted under an OLDER base currency is not " +
            "counted here: it has a rate and is reported by spendBaseByCurrency, and " +
            "counting it twice would put one stay behind two different hints.",
        }),
      spendBaseByCurrency: z.record(z.string(), z.number()),
      awardNights: z.number().int(),
      nightsByType: z.record(z.string(), z.number().int()).openapi({
        description:
          "Keyed by Lodging.type. A plain map rather than named fields because the " +
          "vocabulary grows; a type with zero nights has NO key at all, never a 0.",
      }),
      avgRatingOverall: z.number().nullable(),
      chainLoyaltyMax: z.number().int(),
      sameHotelRepeatMax: z.number().int(),
      plannedStaysCount: z.number().int(),
      plannedNights: z.number().int(),
      plannedLodgingsCount: z.number().int(),
      notedLodgingsCount: z
        .number()
        .int()
        .openapi({
          description:
            "Houses that are no visit and have none coming: bookmarked, or every stay " +
            "cancelled. Never part of any other figure — visited, planned and noted " +
            "partition the list.",
        }),
      nightsByStars: z.record(z.string(), z.number().int()).openapi({
        description:
          "Nights by OFFICIAL star count. A house with no star rating has no key here: " +
          "an unrated guesthouse is not a zero-star, and inventing a bucket for it would " +
          "put campsites next to one-star hotels.",
      }),
      nightsByBoard: z.record(z.string(), z.number().int()),
      perfectStays: z
        .number()
        .int()
        .openapi({
          description:
            "Rated 5 on ALL FOUR columns. A null on any column disqualifies: everything " +
            "was perfect is a claim about everything, and three fives with a blank is a " +
            "claim about three things.",
        }),
      enduredStays: z.number().int(),
      oneNightStays: z.number().int(),
      undatedStays: z
        .number()
        .int()
        .openapi({
          description:
            "Stays with no usable date. They count in every sum, ranking and achievement " +
            "— a hotel you cannot date is still one you slept in — and in no calendar " +
            "series. Reported so a screen can SAY so: a year chart quietly missing eleven " +
            "stays looks exactly like one that has them all.",
        }),
      undatedNights: z.number().int(),
      staysWithUnknownLength: z.number().int(),
      price: lodgingPriceStatsSchema,
      ratings: lodgingRatingStatsSchema,
      geo: lodgingGeoStatsSchema,
      rhythm: lodgingRhythmStatsSchema,
      loyalty: lodgingLoyaltyStatsSchema,
    }),
  })
  .openapi({
    description:
      "Enveloped, unlike most of this router — one of the twelve frozen leaks the " +
      "response-shape ratchet records (ADR 0001). Described as it is rather than " +
      "quietly corrected: a client already reads it this way.",
  });

export type LodgingStatsResponse = z.infer<typeof lodgingStatsResponseSchema>;
