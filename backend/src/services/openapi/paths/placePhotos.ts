/**
 * Photographs offered to a place visit and to a place — the suggestion strip,
 * the link a pick becomes, and the place gallery's cover. Own module so
 * `places.ts` stays well inside the line limit.
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
