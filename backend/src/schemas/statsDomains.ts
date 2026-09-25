import { z } from "./zod";

/**
 * Shapes for the cross-domain `/stats` answers.
 *
 * Same arrangement as `statsAircraft.ts` and `statsFlights.ts`: described once
 * here, inferred by the code (forgejo#52).
 */

// ─── /stats/records ──────────────────────────────────────────────────────────

export const recordIdSchema = z.enum([
  "longest-flight",
  "shortest-flight",
  "busiest-day",
  "longest-aloft",
  "biggest-delay",
  "northernmost",
  "longest-streak",
]);

export const recordUnitSchema = z.enum(["km", "minutes", "flights", "days", "degrees-north"]);

export const travelRecordSchema = z
  .object({
    id: recordIdSchema,
    value: z.number(),
    unit: recordUnitSchema,
    flightId: z.string().optional().openapi({
      description: "The flight this record is about, when it is about one.",
    }),
    airportIata: z.string().optional().openapi({
      description: "The airport it is about, when the record names a place rather than a leg.",
    }),
    depIata: z.string().nullable().optional(),
    arrIata: z.string().nullable().optional(),
    flightNumber: z.string().nullable().optional(),
    durationMinutes: z.number().nullable().optional(),
    date: z.string().optional().openapi({ description: '"YYYY-MM-DD" — a single day.' }),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    legs: z.array(z.string()).optional().openapi({
      description: "Legs flown on the busiest day, in departure order.",
    }),
  })
  .openapi({
    description:
      "Raw parts a client may render; never pre-composed prose. A record the data " +
      "cannot support is absent rather than present with a zero.",
  });

export const travelRecordsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.object({ records: z.array(travelRecordSchema) }),
  })
  .openapi({
    description:
      "Enveloped, unlike most of this router. That is one of the twelve frozen " +
      "leaks the response-shape ratchet records (docs/adr/0001-api-response-shape.md) " +
      "— described here rather than quietly corrected, because a client already " +
      "reads it this way.",
  });

// ─── /stats/travel-account ───────────────────────────────────────────────────

export const travelAccountYearSchema = z.object({
  year: z.string(),
  days: z
    .number()
    .int()
    .openapi({
      description:
        "Days the year contributes — shortened for the current year to days elapsed, " +
        "so a year in progress is not measured against a length it has not reached.",
    }),
  hotelNights: z.number().int(),
  seaNights: z.number().int(),
  airNights: z.number().int().openapi({
    description: "A flight whose departure and arrival fall on different dates.",
  }),
  homeNights: z.number().int(),
});

export const travelAccountSchema = z.object({
  years: z.array(travelAccountYearSchema),
  undatedStays: z
    .number()
    .int()
    .openapi({
      description:
        "Stays with no usable date. They count in the totals — a hotel you cannot " +
        "date is still one you slept in — and in no year, because a guessed " +
        "position would be indistinguishable from a known one. Includes free-pitch " +
        "nights at an undated roadtrip station, which are the same fact.",
    }),
  contestedNights: z.number().int().openapi({
    description: "Nights claimed by more than one record, reported rather than silently picked.",
  }),
});

export const tripAccountRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  category: z.string().nullable(),
  days: z.number().int().nullable().openapi({
    description: "Null when the trip carries no dates at all — then coverage is unanswerable.",
  }),
  coveredDays: z.number().int().nullable().openapi({
    description: "Days inside the trip with a hotel night, a night at sea, or a night in the air.",
  }),
  uncoveredDays: z.number().int().nullable().openapi({
    description: "Days inside the trip with none of those. The nudge: something is missing here.",
  }),
  spendByCurrency: z.record(z.string(), z.number()).openapi({
    description: "Amounts by original currency, NEVER summed across them.",
  }),
  spendBaseByCurrency: z.record(z.string(), z.number()).openapi({
    description: "The lodging slice that HAS an FX snapshot, by the base currency it was taken in.",
  }),
  journalEntries: z.number().int(),
  photoCount: z.number().int(),
});

const keyedCountSchema = z.object({ key: z.string(), count: z.number().int() });

export const tripAccountSchema = z.object({
  trips: z.array(tripAccountRowSchema),
  tripsWithDates: z.number().int(),
  fullyCoveredTrips: z.number().int().openapi({
    description: "Trips whose every travelling day is accounted for.",
  }),
  totalUncoveredDays: z.number().int(),
  avgTripDays: z.number().nullable(),
  longestTripDays: z.number().int().nullable(),
  byCategory: z.array(
    z.object({ key: z.string(), trips: z.number().int(), days: z.number().int() })
  ),
  byTag: z.array(z.object({ key: z.string(), trips: z.number().int() })),
  moods: z.array(keyedCountSchema),
  weather: z.array(keyedCountSchema),
  journalEntries: z.number().int(),
});

export const travelAccountResponseSchema = z.object({
  account: travelAccountSchema,
  trips: tripAccountSchema,
});

export type TravelRecord = z.infer<typeof travelRecordSchema>;
export type RecordId = z.infer<typeof recordIdSchema>;
export type RecordUnit = z.infer<typeof recordUnitSchema>;
export type TravelAccountYear = z.infer<typeof travelAccountYearSchema>;
export type TravelAccount = z.infer<typeof travelAccountSchema>;
export type TripAccountRow = z.infer<typeof tripAccountRowSchema>;
export type TripAccount = z.infer<typeof tripAccountSchema>;
