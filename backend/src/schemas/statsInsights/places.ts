import { z } from "../zod";
import { measureTotalsSchema } from "./shared";

const jumpEnd = z.object({
  visitId: z.string(),
  placeId: z.string(),
  name: z.string(),
  day: z.string(),
});

/** The wire shape of `GET /stats/insights/places` (forgejo#259). */
export const placeInsightsResponseSchema = z
  .object({
    discoveries: z.object({
      byYear: z.array(
        z.object({
          year: z.number().int(),
          discoveries: z.number().int(),
          revisits: z.number().int(),
          unordered: z.number().int().openapi({
            description:
              "Dated visits of a place that also has an undated one — first or not, nobody knows.",
          }),
        })
      ),
      placesWithoutDatedVisit: z.number().int(),
      undatedVisits: z.number().int(),
    }),
    revisits: z.object({
      longestGap: z
        .object({
          placeId: z.string(),
          name: z.string(),
          days: z.number().int(),
          fromVisitId: z.string(),
          toVisitId: z.string(),
          from: z.string(),
          to: z.string(),
        })
        .nullable(),
      longestGapYears: z.number().int(),
      returning: z.array(
        z.object({
          placeId: z.string(),
          name: z.string(),
          years: z.array(z.number().int()),
          visits: z.number().int(),
        })
      ),
    }),
    diversity: z.object({
      trips: z.array(
        z.object({
          tripId: z.string(),
          tripName: z.string(),
          year: z.number().int().nullable(),
          categories: z.array(z.string()),
        })
      ),
      cities: z.array(
        z.object({
          city: z.string(),
          country: z.string().nullable(),
          categories: z.array(z.string()),
        })
      ),
      byYear: z.array(z.object({ year: z.number().int(), categories: z.array(z.string()) })),
      tripCategoriesMax: z.number().int(),
      visitsWithoutTrip: z.number().int(),
    }),
    documentation: z.object({
      visits: z.number().int(),
      withPhoto: z.number().int(),
      withNote: z.number().int(),
      withRating: z.number().int(),
      withNoteAndPhoto: z.number().int(),
      byYear: z.array(
        z.object({
          year: z.number().int(),
          visits: z.number().int(),
          withPhoto: z.number().int(),
          withNote: z.number().int(),
          withRating: z.number().int(),
        })
      ),
    }),
    jump: z.object({
      longest: z.object({ km: z.number(), from: jumpEnd, to: jumpEnd }).nullable().openapi({
        description: "Straight line between the two places — never a distance travelled.",
      }),
      uncertainPairs: z.number().int(),
      undatedVisits: z.number().int(),
    }),
    plannedVisits: z.number().int(),
    totals: measureTotalsSchema,
  })
  .openapi({
    description:
      "Lifetime, with per-year series. Places and visits count by shared/placeCounting.ts: " +
      "a wishlist place counts nowhere, a future-dated visit is a plan, an undated visit " +
      "counts for how many and never for when.",
  });

export type PlaceInsightsResponse = z.infer<typeof placeInsightsResponseSchema>;
