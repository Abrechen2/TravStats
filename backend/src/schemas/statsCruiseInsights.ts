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
  recordedKm: z.number().nullable().openapi({ description: "From the tour's recordings." }),
  plannedKm: z
    .number()
    .nullable()
    .openapi({ description: "From the planned legs — only for a tour with no recording." }),
  ascentM: z.number().nullable(),
});

export const cruiseTypeSchema = z.enum(["seaHeavy", "balanced", "portIntensive"]);

const cruiseMoneySchema = z.object({
  currency: z.string().openapi({ description: "The account's CURRENT base currency." }),
  cruises: z.number().int(),
  unknownPrice: z.number().int().openapi({ description: "Cruises with no recorded price." }),
  excluded: z
    .number()
    .int()
    .openapi({ description: "Priced cruises that cannot be expressed in `currency`." }),
  counted: z.number().int().openapi({ description: "Cruises the figures are read on." }),
  total: z.number().nullable(),
  perSeaDay: z
    .object({ amount: z.number(), seaDays: z.number().int(), cruises: z.array(cruiseRefSchema) })
    .nullable(),
  mostExpensive: z.object({ cruise: cruiseRefSchema, amount: z.number() }).nullable(),
  perLine: z.array(
    z.object({ line: z.string(), total: z.number(), cruises: z.array(cruiseRefSchema) })
  ),
});

const shipProfileSchema = z.object({
  cruises: z.number().int(),
  biggest: z
    .object({
      shipName: z.string(),
      grossTonnage: z.number().int(),
      capacity: z.number().int().nullable(),
      yearBuilt: z.number().int().nullable(),
      cruises: z.array(cruiseRefSchema),
    })
    .nullable(),
  tonnageKnown: z.number().int().openapi({ description: "Cruises whose ship has a tonnage." }),
  averageAge: z
    .object({ years: z.number(), cruises: z.array(cruiseRefSchema) })
    .nullable()
    .openapi({ description: "Ship age at sailing, in years; null when no ship has a build year." }),
  ageKnown: z.number().int(),
});

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
        recordedKm: z.number().nullable(),
        plannedKm: z.number().nullable(),
        onFootRecordedKm: z.number().nullable(),
        onFootPlannedKm: z.number().nullable(),
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
  money: cruiseMoneySchema,
  ships: shipProfileSchema,
  repeatedItineraries: z.array(
    z.object({ ports: z.array(portRef), cruises: z.array(cruiseRefSchema) })
  ),
});

export type CruiseInsights = z.infer<typeof cruiseInsightsSchema>;
export type CruiseRef = z.infer<typeof cruiseRefSchema>;
