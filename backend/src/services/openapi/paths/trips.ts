/**
 * Trip endpoints.
 *
 * A trip is the container everything else can point at: flights, cruises,
 * lodging stays and place visits all carry an optional `tripId`. What lives ON
 * the trip is only what belongs to no single domain — its own stops, its diary,
 * its photos, and the bookings that paid for several things at once.
 *
 * Two families here are not CRUD, and are documented as such: `detect` proposes
 * trips from flights the user already has, and `cleanup` finds trips too small
 * to be worth keeping. Both only report; neither writes without a second call.
 */

import { z } from "zod";

import { registry } from "../registry";
import { documentIdsBodySchema } from "../../../schemas/document";
import { photoFileQuerySchema } from "../../../schemas/photoVariant";
import { captureFieldsSchema } from "../../photos/captureFields";
import {
  errorContent,
  photoConversionUnavailable,
  photoUnreadable,
  tripJournalEntryResponse,
  tripPhotoResponse,
  tripResponse,
  tripStopResponse,
  timeRefused,
} from "./shared";
import { weatherOutcome } from "./openData";
import {
  listTripPhotosQuerySchema,
  tripPhotoUploadFieldsSchema,
  updateTripPhotoSchema,
} from "../../../schemas/tripPhoto";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  createBookingSchema,
  updateBookingSchema,
  createStopSchema,
  updateStopSchema,
  createJournalSchema,
  updateJournalSchema,
} from "../../../schemas/trip";

const tripCreateInput = registry.register(
  "TripCreateInput",
  createTripSchema.openapi("TripCreateInput")
);
const tripUpdateInput = registry.register(
  "TripUpdateInput",
  updateTripSchema.openapi("TripUpdateInput")
);
const stopCreateInput = registry.register(
  "TripStopCreateInput",
  createStopSchema.openapi("TripStopCreateInput")
);
const stopUpdateInput = registry.register(
  "TripStopUpdateInput",
  updateStopSchema.openapi("TripStopUpdateInput")
);
const journalCreateInput = registry.register(
  "TripJournalCreateInput",
  createJournalSchema.openapi("TripJournalCreateInput")
);
const journalUpdateInput = registry.register(
  "TripJournalUpdateInput",
  updateJournalSchema.openapi("TripJournalUpdateInput")
);
const bookingCreateInput = registry.register(
  "BookingCreateInput",
  createBookingSchema.openapi("BookingCreateInput")
);
const bookingUpdateInput = registry.register(
  "BookingUpdateInput",
  updateBookingSchema.openapi("BookingUpdateInput")
);

const tripCostSuperlative = registry.register(
  "TripCostSuperlative",
  z
    .object({
      tripId: z.string().uuid(),
      name: z.string(),
      amount: z
        .number()
        .describe(
          "The money actually spent, in the trip's own dominant currency — " +
            "never a converted figure. Only the ORDER the trips are compared " +
            "in uses the base-currency amount; the label never does."
        ),
      currency: z.string(),
      excluded: z.object({
        count: z.number().int(),
        reason: z.literal("unconvertible"),
      }),
    })
    .describe(
      "Ranked on each trip's total FX base-currency amount across ALL its " +
        "cost sources, computed over every trip the user has — never the " +
        "500-trip / 200-row caps `GET /trips` applies to the list itself. A " +
        "trip carrying any cost item with no FX snapshot (no currency, no " +
        "date, or a failed rate lookup) leaves the comparison rather than " +
        "being ranked on a partial sum; `excluded.count` says how many."
    )
    .openapi("TripCostSuperlative")
);

const tripId = z.object({ id: z.string().uuid() });
const deleted = { description: "Deleted" };
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };

/**
 * The list item carries the relation counts a card or a list row needs, so
 * a client showing N trips does not fetch N detail pages to learn how many
 * sections each has (forgejo#90 — the Companion paid exactly that N+1).
 */
const tripListItem = tripResponse.extend({
  _count: z.object({
    flights: z.number().int(),
    cruises: z.number().int(),
    lodgingStays: z.number().int(),
    routes: z.number().int().describe("Tour sections — the rows served by GET /trips/{id}/routes"),
    photos: z
      .number()
      .int()
      .describe(
        "Trip photos — the rows served by GET /trips/{id}/photos, linked and imported alike"
      ),
    railJourneys: z.number().int().describe("Linked train rides"),
    rentalBookings: z.number().int().describe("Linked rental cars, a cancelled one excluded"),
    roadtrips: z.number().int().describe("Tour sections of kind roadtrip — a subset of `routes`"),
  }),
});

const stopBody = z.object({ stop: tripStopResponse });
const entryBody = z.object({
  entry: tripJournalEntryResponse,
  weatherOutcome: weatherOutcome
    .optional()
    .describe("Absent when an edit needed no weather lookup (same day, weather stored)"),
});

registry.registerPath({
  method: "get",
  path: "/trips",
  summary: "List trips",
  description:
    "Newest first, capped at 500. Each trip carries its bookings, up to 200 " +
    "flights, cruises and stays each, and `_count` with the size of every " +
    "linked collection including tour sections (`routes`) and photos (`photos`). " +
    "`includeInsights=true` additionally runs an UNCAPPED cost comparison over " +
    "every trip the user has and returns `mostExpensiveTrip` — not derivable " +
    "from the (capped) `trips` array above, so callers that need the true " +
    "cross-trip superlative ask for it explicitly rather than every caller of " +
    "this endpoint paying for it.",
  tags: ["Trips"],
  request: {
    query: z.object({
      includeInsights: z
        .enum(["true", "false"])
        .optional()
        .describe("Adds `mostExpensiveTrip` to the response. Default false."),
    }),
  },
  responses: {
    200: {
      description: "Trips",
      content: {
        "application/json": {
          schema: z.object({
            trips: z.array(tripListItem),
            mostExpensiveTrip: tripCostSuperlative
              .nullable()
              .optional()
              .describe("Present only when `includeInsights=true` was passed."),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/entry-suggestions",
  summary: "Suggestions for the trip form's origin and destination labels",
  description:
    "`origins` is the requesting user's current home airport, named as a reader names it " +
    "(never the catalogue's municipality), or empty without one. `destinations` needs " +
    "`tripId`: the places the trip's stays, cruise end ports and outbound flights point at, " +
    "most frequent first, plus a country that two or more of those cities share. Flights " +
    "back to the home airport or to the trip's first departure airport are not destinations. " +
    "Suggestions only — nothing here is written.",
  tags: ["Trips"],
  request: {
    query: z.object({
      tripId: z.string().uuid().optional().describe("An own trip, for its destinations"),
    }),
  },
  responses: {
    200: {
      description: "Ranked suggestions; empty lists where there is nothing to offer",
      content: {
        "application/json": {
          schema: z.object({
            origins: z.array(z.string()),
            destinations: z.array(z.string()),
          }),
        },
      },
    },
    400: badInput,
    401: { description: "Missing or invalid token", content: errorContent },
    404: notFound,
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/journal-moods",
  summary: "Moods the user has written in their journal before",
  description:
    "Distinct moods of the requesting user's journal entries across all their trips, most " +
    "used first, then most recently written; at most eight. Suggestions only.",
  tags: ["Trips"],
  responses: {
    200: {
      description: "Ranked moods; empty when the journal has none",
      content: { "application/json": { schema: z.object({ moods: z.array(z.string()) }) } },
    },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Rate limit exceeded", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}",
  summary: "Get a trip",
  description:
    "Includes everything linked to it: flights, cruises with their ship, ports " +
    "and stops, lodging stays with their property, stops, diary entries and photos.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    200: { description: "Trip", content: { "application/json": { schema: tripResponse } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips",
  summary: "Create a trip",
  tags: ["Trips"],
  request: {
    body: {
      content: { "application/json": { schema: tripCreateInput.and(documentIdsBodySchema) } },
      required: true,
    },
  },
  responses: {
    422: timeRefused,
    201: { description: "Created", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}",
  summary: "Update a trip",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: tripUpdateInput } }, required: true },
  },
  responses: {
    422: timeRefused,
    200: { description: "Updated", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}",
  summary: "Delete a trip",
  description:
    "The trip only. Flights, cruises and stays that pointed at it lose the link " +
    "and survive — deleting a trip is not a way to delete what happened on it.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/flights",
  summary: "Assign flights to a trip",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: assignFlightsSchema } }, required: true },
  },
  responses: {
    200: { description: "Assigned", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/stops",
  summary: "Add a stop to a trip",
  description:
    "A stop is something that happened on the trip and belongs to no other domain " +
    "— a hike, a drive, a place worth naming. Flights, cruises and stays are " +
    "linked rather than repeated here.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: stopCreateInput } }, required: true },
  },
  responses: {
    422: timeRefused,
    201: { description: "Created", content: { "application/json": { schema: stopBody } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/stops/{stopId}",
  summary: "Update a stop",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }),
    body: { content: { "application/json": { schema: stopUpdateInput } }, required: true },
  },
  responses: {
    422: timeRefused,
    200: { description: "Updated", content: { "application/json": { schema: stopBody } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/stops/{stopId}",
  summary: "Delete a stop",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), stopId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/journal",
  summary: "Add a diary entry",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: journalCreateInput } }, required: true },
  },
  responses: {
    422: timeRefused,
    201: { description: "Created", content: { "application/json": { schema: entryBody } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/journal/{entryId}",
  summary: "Update a diary entry",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }),
    body: { content: { "application/json": { schema: journalUpdateInput } }, required: true },
  },
  responses: {
    422: timeRefused,
    200: { description: "Updated", content: { "application/json": { schema: entryBody } } },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/journal/{entryId}",
  summary: "Delete a diary entry",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

const stopNotOnTrip = {
  description:
    "Invalid input; `code` STOP_NOT_ON_TRIP (with `field` stopId) when the stop is not on " +
    "this trip — neither on its timeline nor a station of a roadtrip filed on it. A stop " +
    "that does not exist answers the same.",
  content: errorContent,
};
const photoParams = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photos",
  summary: "List a trip's photos",
  description:
    "The gallery without the rest of the trip, in gallery order, at most 1000; the cover's " +
    "internal row is left out. A journal entry picks its photos from this list (`photoIds`). " +
    "`stopId` narrows it to the photos filed at one stop — a roadtrip station's photos; a " +
    "stop not on the trip is a 400, never an empty list.",
  tags: ["Trips"],
  request: { params: tripId, query: listTripPhotosQuerySchema },
  responses: {
    200: {
      description: "Photos",
      content: {
        "application/json": { schema: z.object({ photos: z.array(tripPhotoResponse) }) },
      },
    },
    400: stopNotOnTrip,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/photos",
  summary: "Upload trip photos",
  description:
    "multipart/form-data; up to 20 files in `photos`. An optional `stopId` field files every " +
    "photo of the request at that stop of the trip (forgejo#139); it is checked before " +
    "anything is stored, and a refused request keeps no row and no file. JPEG, PNG, WebP, " +
    "GIF, HEIC and HEIF are accepted; a HEIC/HEIF original is kept as uploaded and gets a " +
    "JPEG copy for display. `takenAt`, `lat` and `lon` are read from each file's EXIF " +
    "where it carries them (forgejo#192). The optional text fields of the same names " +
    "(companion#59) fill only what the file's EXIF did not say — EXIF wins — and are " +
    "accepted with exactly ONE file; beside several files, or with an offset-less " +
    "`takenAt`, the request is a 400 and nothing is stored.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: {
      content: {
        "multipart/form-data": {
          schema: tripPhotoUploadFieldsSchema.merge(captureFieldsSchema).extend({
            photos: z.array(z.string().openapi({ format: "binary" })),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Uploaded",
      content: {
        "application/json": { schema: z.object({ photos: z.array(tripPhotoResponse) }) },
      },
    },
    400: stopNotOnTrip,
    404: notFound,
    422: photoUnreadable,
    503: photoConversionUnavailable,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/{id}/photos/{photoId}",
  summary: "Update a photo's caption, order, date or stop",
  description:
    "`stopId` files the photo at a stop of this trip or takes it off one (null); absent " +
    "leaves it where it is.",
  tags: ["Trips"],
  request: {
    params: photoParams,
    body: { content: { "application/json": { schema: updateTripPhotoSchema } } },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: z.object({ photo: tripPhotoResponse }) } },
    },
    400: stopNotOnTrip,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/photos/{photoId}",
  summary: "Delete a photo",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid(), photoId: z.string().uuid() }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photos/{photoId}/file",
  summary: "Fetch a photo's bytes",
  description:
    "Ownership-checked and browser-cacheable. Sets its own `Cache-Control: private`, " +
    "overriding the API-wide `no-store` — private, never public, so a shared cache " +
    "cannot hold one user's photo. A HEIC/HEIF original is answered as its JPEG copy " +
    "unless `variant=original` asks for the uploaded bytes.",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid(), photoId: z.string().uuid() }),
    query: photoFileQuerySchema,
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: notFound,
    503: photoConversionUnavailable,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/cover",
  summary: "Set the trip's cover image",
  description:
    "multipart/form-data, field `cover`. HEIC/HEIF is accepted like on the photo upload: " +
    "kept as uploaded, served as its JPEG copy.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: {
    200: { description: "Cover set" },
    404: notFound,
    422: photoUnreadable,
    503: photoConversionUnavailable,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/summarize",
  summary: "Write a summary of the trip with a language model",
  description:
    "Asks the instance's Ollama (Admin → Parser, or OLLAMA_URL) for a three-paragraph " +
    "summary built from the trip's flights, cruises, stays, place visits, stops and " +
    "journal, in the requested language, and STORES it on the trip — the next read of " +
    'the trip carries it, with `summarySource` "llm", `summaryGeneratedAt` and ' +
    "`summaryEntryCount`. A person's edit through PATCH (a CHANGED text) turns the source " +
    'to "user" and clears the other two; null in all three is unknown — every summary ' +
    "written before 2.7. Rate-limited like the parsers; a run can take minutes.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            language: z
              .enum(["de", "en"])
              .optional()
              .describe("Language of the summary. Absent means German."),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Summary",
      content: {
        "application/json": {
          schema: z.object({
            summary: z.string(),
            model: z.string(),
            language: z.enum(["de", "en"]),
            durationMs: z.number().int(),
            summarySource: z
              .literal("llm")
              .describe("Stored on the trip with the text, as are the two fields below"),
            summaryGeneratedAt: z.string().datetime(),
            summaryEntryCount: z
              .number()
              .int()
              .describe(
                "Entries the model was given: flights, cruises, stays, place visits, stops and " +
                  "journal entries"
              ),
          }),
        },
      },
    },
    404: notFound,
    503: { description: "No model configured", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/detect",
  summary: "Propose trips from flights that have none",
  description:
    "A suggestion, not a write: it groups unassigned flights by closeness in time " +
    "and returns candidates. Creating them is a separate call.",
  tags: ["Trips"],
  responses: { 200: { description: "Candidate trips" } },
});

registry.registerPath({
  method: "post",
  path: "/trips/merge",
  summary: "Merge several trips into one",
  tags: ["Trips"],
  responses: {
    200: { description: "Merged", content: { "application/json": { schema: tripResponse } } },
    400: badInput,
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/cleanup/micro",
  summary: "List trips too small to be worth keeping",
  description: "Reports only; dissolving them is the separate call below.",
  tags: ["Trips"],
  responses: { 200: { description: "Micro trips" } },
});

registry.registerPath({
  method: "post",
  path: "/trips/cleanup/dissolve",
  summary: "Dissolve the named trips",
  description:
    "Removes the trips and leaves everything that pointed at them, exactly as " +
    "DELETE /trips/{id} does.",
  tags: ["Trips"],
  responses: { 200: { description: "Dissolved" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/trips/bookings",
  summary: "Create a booking",
  description:
    "A booking is one payment covering several things — the flight and the hotel " +
    "on one reference. Trip cost counts a booking once, and counts flights and " +
    "cruises carrying a price but no booking separately, so neither is doubled.",
  tags: ["Trips"],
  request: {
    body: { content: { "application/json": { schema: bookingCreateInput } }, required: true },
  },
  responses: { 201: { description: "Created" }, 400: badInput },
});

registry.registerPath({
  method: "patch",
  path: "/trips/bookings/{id}",
  summary: "Update a booking",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: bookingUpdateInput } }, required: true },
  },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});
