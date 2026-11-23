import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/** Cover suggestions and "Das bin ich" (spec 2026-11-22-cover-suggestions). */

const provider = z.enum(["immich", "photoprism"]);
const failure = z.enum(["unreachable", "auth", "notFound", "protocol", "invalidUrl"]);

const suggestions = z.object({
  suggestions: z
    .array(
      z.object({
        key: z.string(),
        thumbUrl: z.string(),
        takenAt: z.string().nullable(),
        score: z.number(),
        reasons: z.array(
          z.object({
            code: z.enum([
              "me",
              "placeClose",
              "placeNearby",
              "favorite",
              "highQuality",
              "landscape",
              "resolution",
            ]),
            points: z.number(),
          })
        ),
        apply: z.union([
          z.object({ type: z.literal("photo"), photoId: z.string() }),
          z.object({ type: z.literal("album"), linkId: z.string(), assetId: z.string() }),
          z.object({ type: z.literal("entry"), linkId: z.string() }),
        ]),
      })
    )
    .describe("At most three, best first. Empty means nothing qualified; nothing is ever set."),
  abstained: z.enum(["noTripDates", "noCandidates", "noneQualified"]).nullable(),
  sources: z.array(
    z.object({
      provider,
      photos: z.union([z.literal("ok"), z.literal("notConfigured"), failure]),
      people: z.union([z.literal("ok"), z.literal("notSet"), z.literal("notConfigured"), failure]),
    })
  ),
});

const trip = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/trips/{id}/cover-suggestions",
  summary: "Up to three cover photo suggestions for a trip, with reasons",
  tags: ["Trips"],
  request: { params: trip },
  responses: {
    200: { description: "Suggestions", content: { "application/json": { schema: suggestions } } },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/cover/entry-photo",
  summary: "Use a photo linked to one of the trip's entries as the cover",
  tags: ["Trips"],
  request: {
    params: trip,
    body: {
      content: { "application/json": { schema: z.object({ linkId: z.string().uuid() }) } },
    },
  },
  responses: {
    200: {
      description: "Cover set",
      content: { "application/json": { schema: z.object({ coverImageUrl: z.string() }) } },
    },
    404: { description: "Link not found on this trip", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/photo-sources/{provider}/people",
  summary: "The named people of a photo source, read on demand, and the chosen one",
  tags: ["Settings"],
  request: { params: z.object({ provider }) },
  responses: {
    200: {
      description: "People",
      content: {
        "application/json": {
          schema: z.object({
            people: z.array(z.object({ id: z.string(), name: z.string() })),
            selfPersonId: z.string().nullable(),
          }),
        },
      },
    },
    409: { description: "notConfigured", content: errorContent },
    502: { description: "The source failed (error carries the kind)", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/photo-sources/{provider}/self",
  summary: "Choose which person of a photo source is the account holder (null clears)",
  tags: ["Settings"],
  request: {
    params: z.object({ provider }),
    body: {
      content: {
        "application/json": { schema: z.object({ personId: z.string().min(1).nullable() }) },
      },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: {
        "application/json": { schema: z.object({ selfPersonId: z.string().nullable() }) },
      },
    },
    404: { description: "Not a person of that source", content: errorContent },
    409: { description: "notConfigured", content: errorContent },
    502: { description: "The source failed (error carries the kind)", content: errorContent },
  },
});

/** Automatic covers (owner decision 2026-11-23): the account switch and its undo. */
registry.registerPath({
  method: "get",
  path: "/settings/auto-cover",
  summary: "Whether covers are chosen automatically, and how many the server chose",
  tags: ["Settings"],
  responses: {
    200: {
      description: "Switch and count",
      content: {
        "application/json": {
          schema: z.object({ enabled: z.boolean(), autoCovers: z.number().int() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/auto-cover",
  summary: "Switch automatic covers on or off for the account",
  tags: ["Settings"],
  request: {
    body: {
      content: { "application/json": { schema: z.object({ enabled: z.boolean() }).strict() } },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/auto-cover/covers",
  summary: "Remove every automatically chosen cover; a person's own cover is never touched",
  tags: ["Settings"],
  responses: {
    200: {
      description: "How many were removed",
      content: { "application/json": { schema: z.object({ removed: z.number().int() }) } },
    },
  },
});
