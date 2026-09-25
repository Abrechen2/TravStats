/**
 * GET/POST /rail/roadtrip-conversion/{routeId} — a roadtrip section by rail
 * converted into rail journeys (owner decision 1 of the rail spec).
 * Enveloped like the rest of the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { roadtripConversionBodySchema } from "../../../routes/rail/roadtripConversion";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

const params = z.object({ routeId: z.string().uuid() });

const skipped = z
  .array(
    z.object({
      legId: z.string().uuid(),
      fromStopId: z.string().uuid(),
      toStopId: z.string().uuid(),
      reason: z.enum(["notRail", "stopMissing", "noPosition", "noDate"]),
    })
  )
  .describe("Legs that cannot become a ride, each with its reason");

const preview = registry.register(
  "RailRoadtripConversionPreview",
  z
    .object({
      routeId: z.string().uuid(),
      name: z.string(),
      rides: z.array(
        z.object({
          legId: z.string().uuid(),
          departureStationName: z.string(),
          arrivalStationName: z.string(),
          departureDay: z.string().describe("YYYY-MM-DD; the ride leaves at noon of it"),
          distanceKm: z.number(),
          journeyId: z
            .string()
            .uuid()
            .nullable()
            .describe("The ride an earlier conversion already wrote, else null"),
        })
      ),
      skipped,
      canRemoveSection: z
        .boolean()
        .describe("True only when every leg becomes a ride and there is at least one"),
    })
    .openapi("RailRoadtripConversionPreview")
);

const result = registry.register(
  "RailRoadtripConversionResult",
  z
    .object({
      created: z.number().int(),
      alreadyConverted: z.number().int().describe("Rides an earlier conversion wrote"),
      journeyIds: z.array(z.string().uuid()),
      skipped,
      sectionRemoved: z.boolean(),
    })
    .openapi("RailRoadtripConversionResult")
);

registry.registerPath({
  method: "get",
  path: "/rail/roadtrip-conversion/{routeId}",
  summary: "Preview converting a roadtrip by rail into rail journeys",
  description:
    "One ride per leg of a roadtrip whose vehicle is `rail`. Nothing is written. " +
    "A leg without a day or a position is listed as skipped.",
  tags: ["Rail"],
  request: { params },
  responses: {
    200: {
      description: "What a conversion would write",
      content: { "application/json": { schema: envelope(preview) } },
    },
    401: { description: "Missing or invalid token", content: errorContent },
    404: { description: "Not one of the caller's roadtrips", content: errorContent },
    409: { description: "The roadtrip is not by rail", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/rail/roadtrip-conversion/{routeId}",
  summary: "Convert a roadtrip by rail into rail journeys",
  description:
    "Writes one ride per leg; a ride an earlier conversion wrote is not written " +
    "again. Each leaves at noon on its boarding station's clock with an unknown " +
    "arrival, and its notes say so. `removeSection: true` also deletes the roadtrip " +
    "in the same transaction — refused (409) unless every leg becomes a ride.",
  tags: ["Rail"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: roadtripConversionBodySchema.openapi("RailRoadtripConversionInput"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The rides written and whether the roadtrip went",
      content: { "application/json": { schema: envelope(result) } },
    },
    400: { description: "Invalid body", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    404: { description: "Not one of the caller's roadtrips", content: errorContent },
    409: {
      description: "Not by rail, or removal asked while a leg cannot be converted",
      content: errorContent,
    },
  },
});
