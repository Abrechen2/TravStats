import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { CRUISE_TRACK_SOURCES, pullCruiseDawarichSchema } from "../../../schemas/cruise";
import { LEG_COVERAGE_REASONS, LEG_COVERAGE_STATUSES } from "../../trackCoverage/legCoverage";

/**
 * Recorded tracks of a cruise (2.7), `routes/cruises/tracks.ts`. Enveloped,
 * like every cruise router.
 */

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

export const trackVerdict = registry.register(
  "TrackVerdict",
  z
    .object({
      trackId: z
        .string()
        .uuid()
        .nullable()
        .describe("The recording the verdict is about; null when none reaches the leg at all"),
      status: z.enum(LEG_COVERAGE_STATUSES),
      reason: z
        .enum(LEG_COVERAGE_REASONS)
        .describe(
          "complete / bridgedGaps: the leg is drawn and measured from the recording. " +
            "recordingGap (tours) / tooManyGaps (cruises): the recording runs through the " +
            "leg but too much of it was not recorded. missesFrom: the recording starts " +
            "after the leg began. missesTo: it stops before the leg ended. missesBoth: it " +
            "is about somewhere else."
        ),
    })
    .openapi("TrackVerdict")
);

const window = z
  .object({ startAt: z.string().datetime(), endAt: z.string().datetime() })
  .nullable()
  .describe("The window a Dawarich pull asks for; whole days, widened by 14 h each side");

const cruiseTrackMeta = z.object({
  id: z.string().uuid(),
  cruiseId: z.string().uuid(),
  source: z.enum(CRUISE_TRACK_SOURCES),
  name: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  pointCount: z.number().int().describe("Points of the RAW recording, before simplification"),
  distanceKm: z.number().describe("Recorded distance; holes where the signal was lost excluded"),
  truncated: z.boolean().describe("A Dawarich pull cut short by the page cap"),
  externalRef: z.string().nullable(),
  createdAt: z.string().datetime(),
  coveredLegs: z
    .array(z.number().int())
    .describe("Ordinals of the legs whose line and distance come from this recording"),
});

const cruiseLegTrack = z.object({
  ordinal: z.number().int(),
  fromPortId: z.number().int(),
  toPortId: z.number().int(),
  fromPortName: z.string(),
  toPortName: z.string(),
  distanceKm: z.number().nullable().describe("As counted in the statistics"),
  geometrySource: z
    .enum(["track", "drawn", "sea_route", "chord"])
    .describe(
      "Where the leg's line and kilometres come from, in precedence order: a covering " +
        "recording, a hand-drawn line, the shipping-lane router, a straight chord"
    ),
  coverage: trackVerdict.nullable().describe("Null when the cruise has no recordings"),
  window,
});

const overview = z.object({
  tracks: z.array(cruiseTrackMeta),
  legs: z.array(cruiseLegTrack),
  window,
});

const cruiseParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/cruises/{id}/tracks",
  summary: "A cruise's recordings and what they cover",
  description:
    "The recordings without their lines, and per leg where its line comes from and the " +
    "server's coverage verdict. A cruise leg counts as covered when the recording reaches " +
    "both ports within 10 km, in sailing order, and holes (steps over 20 km) make up at most " +
    "a quarter of it; the holes are bridged by a chord and counted as sailed.",
  tags: ["Cruises"],
  request: { params: cruiseParams },
  responses: {
    200: {
      description: "Recordings and per-leg verdicts",
      content: { "application/json": { schema: envelope(overview) } },
    },
    404: { description: "Cruise not found", content: errorContent },
  },
});

const created = envelope(z.object({ id: z.string().uuid() }));

registry.registerPath({
  method: "post",
  path: "/cruises/{id}/tracks",
  summary: "Upload a recording (GPX, TCX or FIT) of a cruise",
  description:
    "multipart/form-data, one file under 'file' (up to 15 MB), detected by its bytes. " +
    "Optional 'externalRef' and 'origin' ('healthkit' | 'healthconnect') as on the tour " +
    "upload. The cruise's legs are recomputed in the same transaction.",
  tags: ["Cruises"],
  request: { params: cruiseParams },
  responses: {
    201: { description: "Stored", content: { "application/json": { schema: created } } },
    400: { description: "No file, unreadable, or no timestamps", content: errorContent },
    403: { description: "The shared demo account cannot upload", content: errorContent },
    404: { description: "Cruise not found", content: errorContent },
    409: { description: "This externalRef is already stored", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/cruises/{id}/tracks/dawarich",
  summary: "Pull a cruise leg (or the whole voyage) from Dawarich",
  description:
    "With `legOrdinal` the window of that leg, otherwise the whole cruise; either side can " +
    "be given explicitly. Failures are 409: `{error: 'notConfigured'}`, the fixed Dawarich " +
    "kind vocabulary, or a plain message for an empty window.",
  tags: ["Cruises"],
  request: {
    params: cruiseParams,
    body: { content: { "application/json": { schema: pullCruiseDawarichSchema } } },
  },
  responses: {
    201: { description: "Pulled and stored", content: { "application/json": { schema: created } } },
    400: { description: "Invalid body or no window derivable", content: errorContent },
    404: { description: "Cruise or leg not found", content: errorContent },
    409: { description: "No connection, Dawarich failed, or empty window", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/cruises/{id}/tracks/{trackId}",
  summary: "Remove a recording from a cruise",
  description: "The legs it carried fall back to the drawn line, the sea route or the chord.",
  tags: ["Cruises"],
  request: { params: z.object({ id: z.string().uuid(), trackId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Removed",
      content: {
        "application/json": { schema: envelope(z.object({ deleted: z.number().int() })) },
      },
    },
    404: { description: "Cruise or recording not found", content: errorContent },
  },
});
