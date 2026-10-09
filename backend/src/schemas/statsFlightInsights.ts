import { z } from "./zod";

/**
 * The shape of `GET /stats/flight-insights` (forgejo#256): discovery, returns,
 * how the network grew, transfer times and the year's story.
 *
 * Described once, inferred by `services/stats/flightInsights/build.ts`
 * (forgejo#52). Numbers and codes, never sentences: the client names an
 * airport and formats a duration in the reader's language.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const flightReunionSchema = z.object({
  airport: z.string(),
  fromDay: day,
  toDay: day,
  days: z.number().int(),
  years: z
    .number()
    .int()
    .openapi({ description: "Whole calendar years completed between the two days." }),
  fromFlightId: z.string(),
  toFlightId: z.string(),
});

export const measuredTransferSchema = z.object({
  minutes: z.number().int(),
  airport: z.string().nullable(),
  airportChange: z
    .object({ from: z.string(), to: z.string(), km: z.number().nullable() })
    .nullable()
    .openapi({ description: "Set when the next flight leaves from another airport." }),
  day: day.openapi({ description: "The landing's local day at the connecting airport." }),
  arrivingFlightId: z.string(),
  departingFlightId: z.string(),
  arrivingFlightNumber: z.string().nullable(),
  departingFlightNumber: z.string().nullable(),
});

export const flightInsightYearSchema = z.object({
  year: z.number().int(),
  flights: z.number().int(),
  distanceKm: z.number(),
  airportsUsed: z.number().int(),
  newAirports: z.array(z.string()).openapi({
    description: "Airports first recorded in this year — against the whole logbook.",
  }),
  discoveryRate: z.number().nullable().openapi({
    description: "newAirports / airportsUsed, 0–1. Null when the year used no airport.",
  }),
  connections: z.number().int(),
  newConnections: z.array(z.string()),
  repeatedConnections: z.array(z.string()),
  flightsOnNewConnections: z.number().int(),
  flightsOnRepeatedConnections: z.number().int(),
});

export const flightTransferYearSchema = z.object({
  year: z.number().int(),
  count: z.number().int(),
  totalMinutes: z.number().int(),
  medianMinutes: z.number().int(),
  shortest: measuredTransferSchema,
  longest: measuredTransferSchema,
});

export const storyMeasureSchema = z.enum(["flights", "distanceKm", "airports", "connections"]);

export const flightYearStorySchema = z.object({
  year: z.number().int(),
  availableYears: z.array(z.number().int()),
  firstRecordedYear: z.boolean().openapi({
    description: "The logbook's first year: every airport in it is new by definition.",
  }),
  newAirports: z.array(z.string()),
  biggestChange: z
    .object({
      measure: storyMeasureSchema,
      previousYear: z.number().int(),
      previous: z.number(),
      current: z.number(),
      ratio: z.number().openapi({ description: "(current − previous) / previous." }),
    })
    .nullable()
    .openapi({
      description:
        "The figure that moved most against the calendar year before. Null when that " +
        "year has no counted flight — a change from nothing is not a change.",
    }),
  curiousRepetition: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("reunion"), reunion: flightReunionSchema }),
      z.object({
        kind: z.literal("connection"),
        connection: z.string(),
        flights: z.number().int(),
      }),
    ])
    .nullable(),
  funFacts: z
    .object({
      fastestDay: day.nullable(),
      fastestDayFlights: z.number().int(),
      routeMaster: z.string().nullable(),
      routeMasterCount: z.number().int(),
      timezones: z.number().int(),
    })
    .openapi({ description: "The fun facts' own calculator, run over this year's flights." }),
  transfers: z.object({ count: z.number().int(), shortestMinutes: z.number().int().nullable() }),
});

export const flightInsightsSchema = z.object({
  history: z.object({
    firstYear: z.number().int().nullable(),
    lastYear: z.number().int().nullable(),
    airportsTotal: z.number().int(),
    connectionsTotal: z.number().int(),
    countedFlights: z.number().int(),
    undatedFlights: z.number().int().openapi({
      description: "Counted flights with no date: in no year, and in no discovery.",
    }),
    placeholderDateFlights: z
      .number()
      .int()
      .openapi({
        description:
          "Counted flights whose date is a placeholder (a year-only entry): in their year, " +
          "but in no pause between visits and no calendar quarter, which need the real day.",
      }),
    unknownEndFlights: z.number().int().openapi({
      description: "Counted flights with an end that names no airport: on no connection.",
    }),
  }),
  years: z.array(flightInsightYearSchema),
  reunions: z.array(flightReunionSchema).openapi({
    description: "Each airport's longest pause between two visits, longest first, top ten.",
  }),
  quarterAirports: z
    .array(
      z.object({
        airport: z.string(),
        year: z.number().int(),
        visits: z.array(z.object({ quarter: z.number().int(), day, flightId: z.string() })),
      })
    )
    .openapi({
      description: "Airports used in all four calendar quarters of one year (local calendar).",
    }),
  transfers: z.object({
    years: z.array(flightTransferYearSchema),
    shortest: measuredTransferSchema.nullable(),
    longest: measuredTransferSchema.nullable(),
    coverage: z.object({
      bookings: z.number().int(),
      gaps: z.number().int(),
      measured: z.number().int(),
      unknownTime: z.number().int(),
      unknownOrder: z.number().int(),
      conflict: z.number().int(),
      separate: z.number().int(),
      notFlown: z.number().int(),
    }),
  }),
  story: flightYearStorySchema.nullable(),
});

export type FlightInsights = z.infer<typeof flightInsightsSchema>;
export type FlightYearStory = z.infer<typeof flightYearStorySchema>;
export type StoryMeasure = z.infer<typeof storyMeasureSchema>;
