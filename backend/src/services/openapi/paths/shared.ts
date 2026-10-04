/**
 * Schemas and helpers shared across the per-domain path modules.
 *
 * Registering a schema here (rather than inline in a domain file) is what
 * puts it under `components.schemas` and lets several endpoints reference
 * the same definition instead of inlining duplicates.
 */

import { z } from "zod";

import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { createFlightSchema, updateFlightSchema, airportSchema } from "../../../schemas/flight";
import { localDateInputSchema, localTimeInputSchema } from "../../../shared/time/wire";
import {
  TIMES_SCHEMAS,
  flightTimesSchema,
  journalEntryTimesSchema,
  tripStopTimesSchema,
  tripTimesSchema,
} from "../../../schemas/times";
import {
  apiTokenScopeSchema,
  createApiTokenSchema,
  sanitizedApiTokenSchema,
  createdApiTokenSchema,
} from "../../../schemas/apiToken";

export const errorResponse = registry.register(
  "Error",
  z
    .object({
      error: z.string().openapi({ example: "Invalid input" }),
      details: z.array(z.string()).optional(),
      code: z
        .string()
        .optional()
        .describe("Stable machine-readable cause, where the route names one (ApiErrorCode)"),
      field: z
        .string()
        .optional()
        .describe("The request field the cause belongs to, where the route names one"),
    })
    .openapi("Error")
);

export const flightCreateInput = registry.register(
  "FlightCreateInput",
  createFlightSchema.openapi("FlightCreateInput")
);

export const flightUpdateInput = registry.register(
  "FlightUpdateInput",
  updateFlightSchema.openapi("FlightUpdateInput")
);

export const flightResponse = registry.register(
  "Flight",
  z
    .object({
      ...prismaColumns("Flight"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      airline: z.string().nullable(),
      operatingAirline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      aircraft: z.string().nullable(),
      depIata: z.string().nullable(),
      depIcao: z.string().nullable(),
      depName: z.string().nullable(),
      depLat: z.number(),
      depLon: z.number(),
      arrIata: z.string().nullable(),
      arrIcao: z.string().nullable(),
      arrName: z.string().nullable(),
      arrLat: z.number(),
      arrLon: z.number(),
      departureTime: z.string().datetime().nullable(),
      arrivalTime: z.string().datetime().nullable(),
      status: z.string(),
      seatNumber: z.string().nullable(),
      seatClass: z.string().nullable(),
      gate: z.string().nullable(),
      terminal: z.string().nullable(),
      bookingReference: z.string().nullable(),
      ticketNumber: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      taxes: z.number().nullable(),
      fees: z.number().nullable(),
      category: z.string().nullable(),
      tags: z.array(z.string()),
      companions: z.array(z.string()),
      notes: z.string().nullable(),
      createdAt: z.string().datetime(),

      // Every endpoint that returns a flight fills these in; a client may rely
      // on them being present wherever a Flight appears.
      depTimezone: z
        .string()
        .nullable()
        .describe(
          "Legacy: the zone the departure was stored with, or — for a flight written " +
            "before zones were stored — today's catalogue zone of the airport. Read " +
            "`times.departure` instead: it says which of the two it is (`zoneSource`). " +
            "Null means no zone is known; the time is then UTC and must be labelled so."
        ),
      arrTimezone: z.string().nullable().describe("IANA zone of the arrival airport."),
      depCountry: z.string().nullable().describe("ISO country of the departure airport."),
      arrCountry: z.string().nullable().describe("ISO country of the arrival airport."),

      // The one key the routes send that this schema did not publish: 95 of
      // the 96 keys of a listed flight were described, `trip` was not (beta
      // API audit of 2026-09-19, unlisted finding 1). `GET /flights` and
      // `GET /flights/{id}` both `include` it so a list can draw the trip's
      // name and colour without a second request, and a generated client saw
      // `unknown` where a typed object was on the wire.
      //
      // `select`ed, not the whole row: three fields is what the route asks
      // for, so three fields is what is promised. Nullable because a flight
      // need not belong to a trip, and optional because the WRITE paths
      // (`POST`, `PUT`, `PATCH`) answer with the bare updated row and carry no
      // `trip` key at all — a required field here would describe a response
      // that does not exist.
      trip: z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          color: z.string().describe('Hex colour the trip is drawn in, e.g. "#818cf8".'),
        })
        .nullable()
        .optional()
        .describe(
          "The trip this flight belongs to, as the read routes include it. Null when " +
            "the flight is unassigned; absent on the write routes, which return the " +
            "bare row."
        ),
      times: flightTimesSchema,
      durationMinutes: z
        .number()
        .int()
        .nullable()
        .describe(
          "Elapsed minutes with both zones accounted for. Null when the times are " +
            "date-only: there is no honest duration to report, and a client draws a " +
            "great-circle estimate instead of dressing up a placeholder as a fact."
        ),
    })
    .openapi("Flight")
);

export const airportResponse = registry.register(
  "Airport",
  z
    .object({
      id: z.number(),
      iata: z.string().nullable(),
      icao: z.string().nullable(),
      name: z.string(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number(),
      lon: z.number(),
      timezone: z.string().nullable(),
      isClosed: z.boolean(),
    })
    .openapi("Airport")
);

/** A timeline stop, as the stop routes and GET /trips/{id} return it. */
export const tripStopResponse = registry.register(
  "TripStop",
  z
    .object({
      ...prismaColumns("TripStop"),
      startDate: z
        .string()
        .datetime()
        .nullable()
        .describe("Legacy: the stop's wall clock stored as if it were UTC. Read `times.start`."),
      endDate: z.string().datetime().nullable(),
      times: tripStopTimesSchema,
    })
    .openapi("TripStop")
);

/**
 * A trip photo as `toPhotoDto` (routes/trips/photoDto.ts) sends it — the
 * gallery, the upload and update answers, and GET /trips/{id}.
 */
export const tripPhotoResponse = registry.register(
  "TripPhoto",
  z
    .object({
      id: z.string().uuid(),
      url: z.string().describe("The ownership-checked file route, relative to the server"),
      caption: z.string().nullable(),
      // Published as it always was; the time model has not reached photos yet.
      takenAt: z.string().nullable(),
      lat: z
        .number()
        .nullable()
        .describe("Where it was taken (import or upload); null when not stored"),
      lon: z.number().nullable(),
      stopId: z
        .string()
        .uuid()
        .nullable()
        .describe(
          "The stop it is filed at — a station of a roadtrip filed on this trip, or a stop " +
            "of the trip's timeline; null when none. Linked, never derived from `takenAt` " +
            "(forgejo#139). Deleting the stop clears it; the photo stays on the trip."
        ),
      sortIdx: z.number().int(),
      mimetype: z.string(),
      sizeBytes: z.number().int(),
      createdAt: z.string().datetime(),
    })
    .openapi("TripPhoto")
);

/** A diary entry, as the journal routes and GET /trips/{id} return it. */
export const tripJournalEntryResponse = registry.register(
  "TripJournalEntry",
  z
    .object({
      ...prismaColumns("TripJournalEntry"),
      times: journalEntryTimesSchema,
      photos: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("GET /trips/{id}: the photos the entry shows, in the gallery's shape"),
    })
    .openapi("TripJournalEntry")
);

export const tripResponse = registry.register(
  "Trip",
  z
    .object({
      ...prismaColumns("Trip"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
      _count: z
        .object({
          flights: z.number().int(),
          cruises: z.number().int(),
          lodgingStays: z.number().int(),
          routes: z.number().int(),
          photos: z.number().int(),
        })
        .optional()
        .describe("GET /trips: how many of each the trip holds"),
      flights: z
        .array(includedRow("flight"))
        .optional()
        .describe("GET /trips: a slim select per flight"),
      cruises: z.array(includedRow("cruise")).optional(),
      lodgingStays: z.array(includedRow("stay")).optional(),
      bookings: z.array(includedRow("booking")).optional(),
      stops: z.array(tripStopResponse).optional().describe("GET /trips/{id}"),
      journalEntries: z.array(tripJournalEntryResponse).optional().describe("GET /trips/{id}"),
      photos: z
        .array(tripPhotoResponse)
        .optional()
        .describe("GET /trips/{id}: the gallery, the cover's internal row left out"),
      times: tripTimesSchema
        .optional()
        .describe("The trip's first and last day; on the list, detail, create and update"),
    })
    .openapi("Trip")
);

void airportSchema; // exported for consumers; not registered as standalone

registry.register("ApiTokenScope", apiTokenScopeSchema.openapi("ApiTokenScope"));
registry.register("CreateApiTokenInput", createApiTokenSchema.openapi("CreateApiTokenInput"));
registry.register("ApiToken", sanitizedApiTokenSchema.openapi("ApiToken"));
registry.register("CreatedApiToken", createdApiTokenSchema.openapi("CreatedApiToken"));

export const errorContent = {
  "application/json": { schema: errorResponse },
};

/** A photo upload's HEIC/HEIF refusals (forgejo#192) — nothing is stored on either. */
export const photoUnreadable = {
  description: "`code` PHOTO_UNREADABLE: a HEIC/HEIF file that could not be decoded",
  content: errorContent,
};
export const photoConversionUnavailable = {
  description:
    "`code` PHOTO_CONVERSION_UNAVAILABLE: the HEIC/HEIF converter failed (timeout, crash) — " +
    "not the file's fault; retry later",
  content: errorContent,
};

/*
 * The time model's wire shapes (ADR 0002 D3, phase 2). Registered once here so
 * every request body that takes a time points at the same definition, and the
 * web, the Companion and scripts build against one contract.
 */
registry.register("LocalTimeInput", localTimeInputSchema);
registry.register("LocalDateInput", localDateInputSchema);

/*
 * And the read side (phase 4): every entity's `times` object is built from
 * these two, so one component describes every time value a response carries.
 * `__tests__/openapi.timeShape.ratchet.test.ts` holds responses to it.
 */
// TimeValue and LocalDateValue themselves are registered in `registry.ts`,
// before anything that nests them — see the note there.
for (const [name, schema] of Object.entries(TIMES_SCHEMAS)) registry.register(name, schema);

/** A time-model refusal: always 422, always a code, the offending field named. */
export const timeErrorResponse = registry.register(
  "TimeError",
  z
    .object({
      error: z.string().describe("English prose for a log — not for a reader"),
      code: z
        .enum(["TIME_SHAPE_REQUIRED", "LOCAL_TIME_NONEXISTENT", "TZ_UNRESOLVED", "ZONE_UNKNOWN"])
        .describe(
          "TIME_SHAPE_REQUIRED: send {local, zone} / {local, placeRef} or a day as YYYY-MM-DD — " +
            "an offset-less datetime, or a browser's bare ISO-Z on a field that used to hold " +
            "fake UTC (a stale page: reload). LOCAL_TIME_NONEXISTENT: a typed wall clock the " +
            "zone skips (spring-forward gap). TZ_UNRESOLVED: the place has no zone. " +
            "ZONE_UNKNOWN: a zone name the server's tzdata does not know. The lookup being " +
            "down is a different answer: 503 TIMEZONE_LOOKUP_UNAVAILABLE."
        ),
      field: z
        .string()
        .optional()
        .describe("The request field, e.g. `visitedAt`, `stops.0.arrivalTime`"),
    })
    .openapi("TimeError")
);

export const timeErrorContent = {
  "application/json": { schema: timeErrorResponse },
};

/** The 422 a write path that takes a time answers with. */
export const timeRefused = {
  description: "A time refused by the time model (ADR 0002)",
  content: timeErrorContent,
};
