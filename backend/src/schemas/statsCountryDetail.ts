import { z } from "./zod";

/**
 * The shape of `GET /stats/countries/{code}` — one country, and what proves
 * the traveller was in it.
 *
 * Described once, inferred by `services/stats/countryDetail.ts` (forgejo#52).
 * The prose is the reasoning that was already on those fields: most of it is
 * about the DIFFERENCE between kinds of evidence, which is the thing a client
 * cannot work out from a type.
 */

export const continentSchema = z.enum([
  "Africa",
  "Antarctica",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
]);

export const passportEvidenceSchema = z.enum(["flight", "lodging", "port", "place", "track"]);

export const countryAirportUseSchema = z.object({
  iata: z.string(),
  visits: z.number().int().openapi({ description: "Flights that began or ended here." }),
  firstDate: z.string().nullable().openapi({
    description: "First visit, ISO date. Null when no dated flight used it.",
  }),
});

const timelineFlightSchema = z.object({
  kind: z.literal("flight"),
  date: z.string().nullable(),
  flightId: z.string(),
  flightNumber: z.string().nullable(),
  depIata: z.string().nullable(),
  arrIata: z.string().nullable(),
  airportIata: z.string().nullable().openapi({
    description: "The end of the leg that lies inside this country.",
  }),
});

const timelinePortSchema = z.object({
  kind: z.literal("port"),
  date: z.string().nullable(),
  cruiseId: z.string(),
  portName: z.string().nullable(),
});

const timelinePlaceSchema = z.object({
  kind: z.literal("place"),
  date: z.string().nullable(),
  placeId: z.string(),
  name: z.string(),
});

const timelineLodgingSchema = z.object({
  kind: z.literal("lodging"),
  date: z.string().nullable(),
  lodgingId: z.string(),
  name: z.string(),
});

const timelineTrackSchema = z
  .object({
    kind: z.literal("track"),
    date: z.string().nullable(),
    days: z.number().int(),
    points: z.number().int(),
  })
  .openapi({
    description:
      "Measured presence — ONE entry for the whole country, not one per day. The " +
      "other kinds name a record somebody typed and can go and edit; a country-day " +
      "is a reduction of a location history on the user's own server, and there is " +
      "nothing here to correct except the connection that produced it. `points` is " +
      "published RAW and deliberately not turned into a word: the payload cannot " +
      "say whether a fix was measured by GPS or estimated from a photograph, so a " +
      "day held up by four hundred fixes and a day held up by one must stay " +
      "distinguishable without anyone deciding on the reader's behalf what that " +
      "difference means.",
  });

export const countryTimelineEntrySchema = z.discriminatedUnion("kind", [
  timelineFlightSchema,
  timelinePortSchema,
  timelinePlaceSchema,
  timelineLodgingSchema,
  timelineTrackSchema,
]);

export const countryDetailSchema = z.object({
  code: z.string().openapi({
    description: "ISO-3166 alpha-2. Never a flag: flags are political and age.",
  }),
  continent: continentSchema.nullable(),
  evidence: passportEvidenceSchema.openapi({
    description: "The strongest proof, in the passport's own vocabulary.",
  }),
  isHome: z.boolean().openapi({ description: "A home airport of the user's is in this country." }),
  entries: z.number().int().openapi({ description: "Flights that began or ended here." }),
  firstYear: z.number().int().nullable(),
  lastYear: z.number().int().nullable(),
  airports: z.array(countryAirportUseSchema).openapi({
    description: "Most-used first. The client groups equal counts.",
  }),
  portCalls: z.number().int().openapi({ description: "Port calls of SAILED cruises here." }),
  places: z.number().int(),
  lodgings: z.number().int().openapi({
    description: "Houses here whose record proves presence.",
  }),
  trackDays: z
    .number()
    .int()
    .openapi({
      description:
        "Distinct days a location history placed the traveller here. Zero for an " +
        "account that has none, which is most of them.",
    }),
  anchor: z
    .object({ iata: z.string(), lat: z.number(), lon: z.number() })
    .nullable()
    .openapi({
      description:
        "The busiest visited airport that carries coordinates — what a map centres " +
        "on. Null when none does, so the client drops its globe control rather than " +
        "opening a sphere somewhere else.",
    }),
  timeline: z.array(countryTimelineEntrySchema).openapi({
    description: "Newest first, undated last. Raw parts, never composed prose.",
  }),
  timelineTruncated: z.boolean(),
});

export type CountryAirportUse = z.infer<typeof countryAirportUseSchema>;
export type CountryTimelineEntry = z.infer<typeof countryTimelineEntrySchema>;
export type CountryDetail = z.infer<typeof countryDetailSchema>;
