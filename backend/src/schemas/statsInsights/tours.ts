import { z } from "../zod";
import { measureTotalsSchema } from "./shared";

const covered = z.object({
  total: z.number(),
  tours: z
    .number()
    .int()
    .openapi({ description: "How many tours the sum rests on — its coverage." }),
});

const figures = z.object({
  activity: z.string(),
  completed: z.number().int(),
  km: covered,
  ascentM: covered,
  movingSeconds: covered.openapi({
    description: "From recordings only; never a planned duration.",
  }),
  pauseSeconds: covered.openapi({ description: "Recorded elapsed time minus moving time." }),
});

const record = z
  .object({
    tourId: z.string(),
    name: z.string(),
    value: z.number(),
    source: z.enum(["track", "route"]).optional(),
  })
  .nullable();

/** The wire shape of `GET /stats/insights/tours` (forgejo#264). */
export const tourInsightsResponseSchema = z
  .object({
    byActivity: z.array(figures),
    all: figures,
    records: z.array(
      z.object({ activity: z.string(), longest: record, mostAscent: record, highest: record })
    ),
    rhythm: z.object({
      byYear: z.array(z.object({ year: z.number().int(), tours: z.number().int() })),
      byMonth: z.array(z.number().int()).length(12),
      firstAreas: z.array(
        z.object({
          country: z.string(),
          day: z.string().nullable(),
          tourId: z.string(),
          name: z.string(),
        })
      ),
      repeatedAreas: z.array(z.object({ country: z.string(), tours: z.number().int() })),
      withoutArea: z.number().int(),
    }),
    links: z.object({
      onTrip: z.number().int(),
      fromRoadtrip: z.number().int(),
      duringCruise: z.number().int(),
      standalone: z.number().int(),
      excursions: z
        .object({ completed: z.number().int(), km: z.number(), planned: z.number().int() })
        .openapi({ description: "Guided excursions: tours, never bus rides or driven km." }),
    }),
    planned: z.number().int(),
    undated: z.number().int(),
    partial: z.number().int(),
    totals: measureTotalsSchema,
  })
  .openapi({
    description:
      "Lifetime with per-year series. A tour counts once it has a recording or its day " +
      "lies before today at its place (shared/tour/tourCounting.ts); climb, moving time and " +
      "height come only from recordings, areas from the boundary set at its first point.",
  });

export type TourInsightsResponse = z.infer<typeof tourInsightsResponseSchema>;
