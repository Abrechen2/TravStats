import { z } from "../zod";
import { measureTotalsSchema } from "./shared";

const phase = z.enum(["past", "current", "planned", "undated"]);

/** The wire shape of `GET /stats/insights/roadtrips` (forgejo#260). */
export const roadtripInsightsResponseSchema = z
  .object({
    roadtrips: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        year: z.number().int().nullable(),
        phase,
        km: z
          .object({
            recorded: z.number(),
            current: z.number(),
            planned: z.number(),
            unplaced: z.number(),
          })
          .openapi({
            description:
              "Recorded = driven by the timeline rule (shared/tour/roadtripTimeline.ts); " +
              "current = today's stage; planned = ahead; unplaced = undated on a roadtrip under way.",
          }),
        kmBySource: z.record(z.string(), z.number()).openapi({
          description: "Recorded km per distance source: straight | drawn | routed | track.",
        }),
        kmByMode: z.record(z.string(), z.number()).openapi({
          description: "Recorded km per leg mode. Ferry and rail km are never driven km.",
        }),
        nights: z.object({ recorded: z.number().int(), planned: z.number().int() }),
        nightsByStyle: z.object({
          pitch: z.number().int(),
          campsite: z.number().int(),
          lodging: z.number().int(),
        }),
        unknownLengthStations: z.number().int(),
        countries: z.object({
          recorded: z.array(z.string()),
          planned: z.array(z.string()),
        }),
        restDays: z.number().int().nullable().openapi({
          description: "Null unless the roadtrip is over and every station is dated.",
        }),
        tours: z.object({
          completed: z.number().int(),
          km: z.number(),
          ascentM: z.number().nullable(),
        }),
      })
    ),
    pace: z.object({
      dayStages: z.number().int(),
      medianDayKm: z.number().nullable(),
      longestDay: z
        .object({ roadtripId: z.string(), name: z.string(), day: z.string(), km: z.number() })
        .nullable(),
      unstagedLegs: z.number().int(),
      restDays: z.number().int(),
      fullyDatedTrips: z.number().int(),
    }),
    totals: measureTotalsSchema,
  })
  .openapi({
    description:
      "Lifetime, per roadtrip, filed in the year it started. What has happened, what is " +
      "today and what is planned are kept apart; nights are counted once (a linked stay " +
      "owns its night); day tours stand beside the driving, never inside it.",
  });

export type RoadtripInsightsResponse = z.infer<typeof roadtripInsightsResponseSchema>;
