import { z } from "../zod";
import { measureTotalsSchema } from "./shared";

const pricePoint = z.object({
  stayId: z.string(),
  date: z.string().openapi({ description: "As precise as the stay: YYYY-MM-DD, YYYY-MM or YYYY." }),
  perNight: z.number(),
});

/** The wire shape of `GET /stats/insights/lodging` (forgejo#258). */
export const lodgingInsightsResponseSchema = z
  .object({
    sleepStyle: z.object({
      byYear: z.array(
        z.object({
          year: z.number().int(),
          nightsByType: z.record(z.string(), z.number().int()),
          nights: z.number().int(),
        })
      ),
      unplacedNights: z.number().int(),
      unknownLengthStays: z.number().int().openapi({
        description: "Counted stays whose length nobody recorded — in no share, never as 0 nights.",
      }),
    }),
    revisits: z.object({
      houses: z.array(
        z.object({
          lodgingId: z.string(),
          name: z.string(),
          years: z.array(z.number().int()),
          stays: z.number().int(),
        })
      ),
      longestGap: z
        .object({
          lodgingId: z.string(),
          name: z.string(),
          days: z.number().int(),
          fromStayId: z.string(),
          toStayId: z.string(),
          from: z.string(),
          to: z.string(),
        })
        .nullable()
        .openapi({ description: "Needs two real dates on both sides; null rather than a guess." }),
      sameHouseYearsMax: z.number().int(),
      returnedHouses: z.number().int(),
    }),
    tripBases: z.object({
      trips: z.array(
        z.object({
          tripId: z.string(),
          tripName: z.string(),
          year: z.number().int(),
          houses: z.number().int(),
          changes: z.number().int(),
          longestBaseNights: z.number().int(),
          longestBaseLodgingId: z.string(),
          longestBaseName: z.string(),
          overlapNights: z.number().int().openapi({
            description: "Nights booked at two houses at once; counted once in every night total.",
          }),
          types: z.array(z.string()),
          completed: z.boolean(),
        })
      ),
      staysWithoutTrip: z.number().int(),
      undatedTripStays: z.number().int(),
      typesPerCompletedTripMax: z.number().int(),
    }),
    priceTrends: z.object({
      groups: z.array(
        z.object({
          lodgingId: z.string(),
          name: z.string(),
          roomCategory: z.string().nullable(),
          board: z.string().nullable(),
          currency: z
            .string()
            .openapi({ description: "One currency per group — never converted." }),
          stays: z.number().int(),
          first: pricePoint,
          last: pricePoint,
          changePct: z.number(),
          thin: z.boolean().openapi({ description: "Fewer than three priced stays." }),
        })
      ),
      singlePricedStays: z.number().int(),
      unpricedStays: z.number().int(),
      awardStays: z.number().int(),
      undatedPricedStays: z.number().int(),
    }),
    weekRhythm: z.object({
      byYear: z.array(
        z.object({
          year: z.number().int(),
          weekendNights: z.number().int(),
          weekdayNights: z.number().int(),
          businessNights: z.number().int(),
          nightsBySeason: z.record(z.string(), z.number().int()),
        })
      ),
      weekendNights: z.number().int(),
      weekdayNights: z.number().int(),
      businessNights: z.number().int().openapi({
        description: "Only nights on trips explicitly marked business — never inferred.",
      }),
      unlabelledNights: z.number().int(),
      notWalkableNights: z.number().int(),
    }),
    calendar: z.object({
      byYear: z.array(z.object({ year: z.number().int(), months: z.array(z.number().int()) })),
      fullYears: z.array(z.number().int()),
      monthsInYearMax: z.number().int(),
    }),
    plannedStays: z.number().int().openapi({
      description: "Stays whose check-out is still ahead — counted in no figure here.",
    }),
    totals: measureTotalsSchema,
  })
  .openapi({
    description:
      "Lifetime, with per-year series where a figure has a year. A stay counts once its " +
      "check-out is past (shared/lodgingCounting.ts); nights fall on the hotel-local date they start.",
  });

export type LodgingInsightsResponse = z.infer<typeof lodgingInsightsResponseSchema>;
