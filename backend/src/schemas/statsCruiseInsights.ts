import { z } from "./zod";

/**
 * The shape of `GET /stats/cruise-insights` (forgejo#257): the special events
 * per voyage, new ports against ports seen again, time in port, shore
 * excursions, sea-day patterns and identical itineraries.
 *
 * Described once, inferred by `services/stats/cruiseInsights/build.ts`
 * (forgejo#52). Ids, numbers and the user's own names — never sentences.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const cruiseRefSchema = z.object({
  id: z.string(),
  label: z.string().openapi({ description: "Route, ship or line — the user's own name." }),
  startDate: day.nullable(),
});

const portRef = z.object({ id: z.number().int(), name: z.string() });

export const cruiseEventSchema = z.enum([
  "equator",
  "dateline",
  "birthdayAtSea",
  "newYearAtSea",
  "canal",
  "polar",
]);

const portStaySchema = z.object({
  cruise: cruiseRefSchema,
  stopId: z.string(),
  portName: z.string(),
  day: day.nullable(),
  minutes: z.number().int(),
});

const linkedTourSchema = z.object({
  id: z.string(),
  name: z.string(),
  activity: z.string().nullable(),
  day,
  portName: z.string(),
  distanceKm: z.number().nullable(),
  ascentM: z.number().nullable(),
});

export const cruiseTypeSchema = z.enum(["seaHeavy", "balanced", "portIntensive"]);

export const cruiseInsightsSchema = z.object({
  year: z.number().int().nullable().openapi({
    description: "The `?year=` the per-cruise lists are cut to; null for every year.",
  }),
  cruises: z.number().int().openapi({ description: "Sailed cruises in scope." }),
  events: z.object({
    birthdayKnown: z.boolean().openapi({
      description: "False when no birthday is set: the birthday event then abstains.",
    }),
    list: z.array(z.object({ event: cruiseEventSchema, cruises: z.array(cruiseRefSchema) })),
  }),
  ports: z.object({
    years: z.array(
      z.object({
        year: z.number().int(),
        cruises: z.number().int(),
        ports: z.number().int(),
        newPorts: z.array(portRef),
        revisitedPorts: z.number().int(),
      })
    ),
    perCruise: z.array(
      z.object({
        cruise: cruiseRefSchema,
        ports: z.number().int(),
        newPorts: z.number().int(),
        revisitedPorts: z.number().int(),
        unresolvedCalls: z.number().int(),
      })
    ),
    longestReunion: z
      .object({
        portId: z.number().int(),
        portName: z.string(),
        fromCruise: cruiseRefSchema,
        toCruise: cruiseRefSchema,
        fromDay: day,
        toDay: day,
        days: z.number().int(),
      })
      .nullable(),
    repeatPorts: z
      .array(
        z.object({
          portId: z.number().int(),
          portName: z.string(),
          cruises: z.array(cruiseRefSchema),
        })
      )
      .openapi({ description: "Ports on at least two cruises, most cruises first, top ten." }),
    undatedCruises: z.number().int(),
    unresolvedCalls: z.number().int(),
  }),
  portStays: z.object({
    calls: z.number().int(),
    measured: z.number().int(),
    missingTime: z.number().int(),
    inconsistent: z.number().int(),
    totalMinutes: z.number().int(),
    averageMinutes: z.number().nullable().openapi({
      description: "Over measured calls only; null when none was measured.",
    }),
    longest: portStaySchema.nullable(),
    shortest: portStaySchema.nullable(),
  }),
  excursions: z.object({
    toursVisible: z.boolean(),
    linkRuleKm: z.number(),
    cruisesWithExcursions: z.number().int(),
    documentedCalls: z.number().int(),
    portsWithExcursions: z.number().int(),
    perCruise: z.array(
      z.object({
        cruise: cruiseRefSchema,
        calls: z.number().int(),
        notedCalls: z.number().int(),
        documentedCalls: z.number().int(),
        tours: z.array(linkedTourSchema).nullable(),
        activities: z.record(z.string(), z.number().int()).nullable(),
        distanceKm: z.number().nullable(),
        onFootKm: z.number().nullable(),
        ascentM: z.number().nullable(),
      })
    ),
  }),
  dayPattern: z.object({
    years: z.array(
      z.object({
        year: z.number().int(),
        cruises: z.number().int(),
        seaDays: z.number().int(),
        portDays: z.number().int(),
        seaHeavy: z.number().int(),
        balanced: z.number().int(),
        portIntensive: z.number().int(),
        unclassified: z.number().int(),
      })
    ),
    perCruise: z.array(
      z.object({
        cruise: cruiseRefSchema,
        seaDays: z.number().int(),
        portDays: z.number().int(),
        listedDays: z.number().int(),
        unlistedDays: z.number().int().nullable(),
        type: cruiseTypeSchema.nullable(),
      })
    ),
  }),
  repeatedItineraries: z.array(
    z.object({ ports: z.array(portRef), cruises: z.array(cruiseRefSchema) })
  ),
});

export type CruiseInsights = z.infer<typeof cruiseInsightsSchema>;
export type CruiseRef = z.infer<typeof cruiseRefSchema>;
