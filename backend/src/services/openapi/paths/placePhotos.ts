/**
 * Photographs offered to a place visit and to a place — the suggestion strip,
 * the link a pick becomes, and the place gallery's cover — and the trip photos
 * a stay, a flight and a cruise show by when and where they were taken. Own
 * module so `places.ts` stays well inside the line limit.
 *
 * The rule across all of it: a library id is served or linked only after the
 * server found it itself, in a search against the caller's own connection.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { linkPicksSchema, placeCoverSchema } from "../../../schemas/place";

const placesTag = ["Places"];
const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();

const suggestion = z.object({
  kind: z.enum(["trip", "library"]),
  id: z.string().describe("Trip photo id, or Immich asset id"),
  url: z.string().describe("Where the thumbnail is served — ownership-checked"),
  takenAt: z.string().nullable(),
  distanceM: z.number().int().describe("Metres from the place"),
});

registry.registerPath({
  method: "get",
  path: "/places/visits/{visitId}/photo-suggestions",
  summary: "Photographs this visit could show",
  description:
    "The caller's trip photos taken on the visit's day (in the place's time zone) within " +
    "300 m of the place, and — with an Immich connection — the library's photos of that day " +
    "whose EXIF position is as close. At most 24 of each; photos already on the visit are " +
    "left out. An undated visit gets none. `library` says whether the library was searched: " +
    "`ok`, `notConfigured`, or the failure kind.",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid }) },
  responses: {
    200: {
      description: "Suggestions",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              day: z.string().nullable(),
              suggestions: z.array(suggestion),
              library: z.enum([
                "ok",
                "notConfigured",
                "unreachable",
                "auth",
                "notFound",
                "protocol",
                "invalidUrl",
              ]),
            }),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/{visitId}/photo-suggestions/link",
  summary: "Link picked photographs to a visit",
  description:
    "Links, never copies: a trip photo must be the caller's, a library id must be among the " +
    "visit's suggestions (re-checked on the server). Anything else is skipped and counted. " +
    "Picking a photo already linked adds nothing.",
  tags: placesTag,
  request: {
    params: z.object({ visitId: uuid }),
    body: { content: { "application/json": { schema: linkPicksSchema } } },
  },
  responses: {
    200: {
      description: "What was linked",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({ linked: z.number().int(), skipped: z.number().int() }),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/{visitId}/photo-suggestions/refusals",
  summary: 'Refuse suggested photographs for a visit ("Nicht diese")',
  description:
    "Kept on the server, per visit, so the suggestion list leaves them out from then on — on " +
    "every device (forgejo#132 item 13). Another visit is still offered the same picture. Same " +
    "body as a link: a trip photo must be the caller's (anything else is skipped and counted); " +
    "a library id is stored as given, since a refusal only ever narrows the caller's own list. " +
    "Refusing one already refused adds nothing.",
  tags: placesTag,
  request: {
    params: z.object({ visitId: uuid }),
    body: { content: { "application/json": { schema: linkPicksSchema } } },
  },
  responses: {
    200: {
      description: "What was refused",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({ refused: z.number().int(), skipped: z.number().int() }),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/places/visits/{visitId}/photo-suggestions/refusals",
  summary: "Offer a visit's refused photographs again",
  description: "Removes every refusal of the visit; the next listing suggests them again.",
  tags: placesTag,
  request: { params: z.object({ visitId: uuid }) },
  responses: {
    200: {
      description: "How many refusals were removed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({ cleared: z.number().int() }),
          }),
        },
      },
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/places/visits/{visitId}/photo-suggestions/library/{assetId}/file",
  summary: "Thumbnail of a suggested library photo",
  description:
    "404 unless the asset is among the visit's suggestions. Private, immutable caching by ETag.",
  tags: placesTag,
  request: {
    params: z.object({ visitId: uuid, assetId: uuid }),
    query: z.object({ size: z.enum(["thumbnail", "preview", "original"]).optional() }),
  },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    304: { description: "Unchanged" },
    404: notFound,
    409: { description: "Immich is not configured", content: errorContent },
    502: { description: "Immich did not deliver the asset" },
  },
});

registry.registerPath({
  method: "put",
  path: "/places/{id}/cover",
  summary: "Choose the place page's lead photograph",
  description:
    "The photo must belong to a visit of this place, and the place to the caller (404 " +
    "otherwise). `null` returns the page to its default, the first photograph.",
  tags: placesTag,
  request: {
    params: z.object({ id: uuid }),
    body: { content: { "application/json": { schema: placeCoverSchema } } },
  },
  responses: {
    200: {
      description: "Saved",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({ coverPhotoId: uuid.nullable() }),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

const windowPhotos = {
  200: {
    description: "Photos, oldest first, at most 48, with the rule that found them",
    content: {
      "application/json": {
        schema: z.object({
          success: z.boolean(),
          data: z.object({
            photos: z.array(
              z.object({
                id: uuid,
                url: z.string(),
                caption: z.string().nullable(),
                takenAt: z.string().nullable(),
                lat: z.number().nullable().describe("Where it was taken; null when not stored"),
                lon: z.number().nullable(),
              })
            ),
            total: z
              .number()
              .int()
              .describe("Every photo the window matches — more than `photos` when capped"),
            limit: z.number().int().describe("The cap on `photos` (48)"),
            window: z
              .object({
                basis: z
                  .enum(["instant", "localDay", "utcDay"])
                  .describe(
                    "`instant`: ranges are ISO instants. `localDay`: calendar days, inclusive, " +
                      "read in `timeZone`. `utcDay`: calendar days read in UTC."
                  ),
                ranges: z.array(z.object({ from: z.string(), to: z.string() })),
                timeZone: z.string().nullable(),
                radiusKm: z
                  .number()
                  .nullable()
                  .describe("Lodging only: how far from `center` a photo may have been taken"),
                center: z.object({ lat: z.number(), lon: z.number() }).nullable(),
              })
              .nullable()
              .describe("The rule that found the photos; null when the entry has none"),
            reason: z
              .enum(["notOnTrip", "noCoordinates", "noDates", "notRealInstants"])
              .nullable()
              .describe(
                "Why `window` is null: the entry is on no trip, the lodging has no position, " +
                  "the entry has no dates, or its times are wall clocks rather than instants"
              ),
          }),
        }),
      },
    },
  },
  400: badInput,
  404: notFound,
};

registry.registerPath({
  method: "get",
  path: "/lodging/{id}/trip-photos",
  summary: "Trip photos taken at this lodging",
  description:
    "The caller's trip photos taken on a day of one of the lodging's stays (in the lodging's " +
    "time zone) within 500 m of it. Read-only and computed per request; none without coordinates.",
  tags: ["Lodging"],
  request: { params: z.object({ id: uuid }) },
  responses: windowPhotos,
});

registry.registerPath({
  method: "get",
  path: "/flights/{id}/trip-photos",
  summary: "Trip photos taken during this flight",
  description:
    "Photos of the flight's trip taken between departure and arrival. None when the flight is " +
    "on no trip or its times are not real instants (a wall clock stored as UTC).",
  tags: ["Flights"],
  request: { params: z.object({ id: uuid }) },
  responses: windowPhotos,
});

registry.registerPath({
  method: "get",
  path: "/cruises/{id}/trip-photos",
  summary: "Trip photos taken during this cruise",
  description:
    "Photos of the cruise's trip taken from its first to its last day, compared by UTC day. " +
    "None when the cruise is on no trip.",
  tags: ["Cruises"],
  request: { params: z.object({ id: uuid }) },
  responses: windowPhotos,
});

registry.registerPath({
  method: "get",
  path: "/rail/{id}/trip-photos",
  summary: "Trip photos taken during this train ride",
  description:
    "Photos of the ride's trip taken between departure and arrival. None when the ride is on " +
    "no trip, has no arrival, or a station has no time zone (its times are then wall clocks).",
  tags: ["Rail"],
  request: { params: z.object({ id: uuid }) },
  responses: windowPhotos,
});
