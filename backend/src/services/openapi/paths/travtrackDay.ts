import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackDayQuerySchema, travTrackExportQuerySchema } from "../../../schemas/travtrack";
import { GAP_REASONS } from "../../travtrack/limits";

/**
 * TravTrack's day view and export (TravTrack plan T6). Beside `travtrack.ts`,
 * which carries capture, points, summary and zones.
 */

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

const span = { fromMs: z.number().int(), untilMs: z.number().int() };

const storedPoint = z
  .tuple([z.number().int(), z.number(), z.number(), z.number().nullable()])
  .describe("`[tMs, lat, lon, accuracyM]`");

const day = z.object({
  date: z.string().describe("The day asked for, `YYYY-MM-DD`"),
  zone: z.string().describe("The profile zone the day is read on"),
  segments: z
    .array(z.array(storedPoint))
    .describe("Stretches cut at gaps, deleted spans and reported pauses; privacy-cut"),
  coverage: z
    .array(
      z.object({
        ...span,
        state: z.enum(["recorded", "noData", "deleted", "phonePaused"]),
      })
    )
    .describe(
      "The whole day in consecutive pieces. A privacy zone is never a state of its own: " +
        "an hour inside one reads as noData."
    ),
  context: z
    .array(
      z.object({
        ...span,
        kind: z.enum(["flight", "trip", "home"]),
        id: z.string().nullable().describe("The flight or trip; null for home"),
        label: z.string(),
      })
    )
    .describe("What TravStats knows of the day: flights, trips, stretches within 300 m of home"),
  pointCount: z.number().int(),
  truncated: z.boolean().describe("More points than one day answer carries"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/day",
  summary: "One day of the TravTrack history",
  description:
    "On the profile clock: the lines, what the phone did and did not record, and the day's " +
    "flights, trips and home stretches. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { query: travTrackDayQuerySchema },
  responses: {
    200: { description: "The day", content: { "application/json": { schema: day } } },
    400: { description: "VALIDATION_FAILED: not a day", content: errorContent },
    403: disabled,
  },
});

const exportJson = z.object({
  version: z.literal(1),
  origin: z.literal("travtrack"),
  from: z.string(),
  to: z.string(),
  coverage: z
    .enum(["complete", "truncated"])
    .describe("truncated: more points than one export carries; ask again from `next`"),
  next: z.string().nullable().describe("The first instant left out, or null"),
  cursor: z
    .string()
    .nullable()
    .describe("The last point given, `<tMs>:<seq>`, where the next part continues; or null"),
  points: z.array(
    z.object({
      t: z.string(),
      lat: z.number(),
      lon: z.number(),
      accuracy: z.number().nullable(),
      altitude: z.number().nullable(),
      speed: z.number().nullable(),
      course: z.number().nullable(),
      deviceId: z.string().nullable(),
      purpose: z.enum(["everyday", "flight", "trip"]),
      segment: z.number().int().describe("Index of the stretch the point belongs to"),
    })
  ),
  gaps: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      reason: z.enum(GAP_REASONS),
      deviceId: z.string(),
    })
  ),
  deletedRanges: z.array(z.object({ from: z.string(), to: z.string() })),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/export",
  summary: "A span of the TravTrack history as a file",
  description:
    "GPX 1.1 (one `<trkseg>` per stretch) or TravTrack's JSON, privacy-cut, as an attachment. " +
    "Headers `X-TravTrack-Origin`, `X-TravTrack-Coverage` and, when truncated, " +
    "`X-TravTrack-Next`, `X-TravTrack-Until` and `X-TravTrack-Cursor`: the rest is " +
    "`?from=<Next>&to=<Until>&cursor=<Cursor>` (the cursor is the last point given, by " +
    "time and order, so points sharing an instant are neither repeated nor lost). " +
    "Reachable with TravTrack off while the account holds data.",
  tags: ["TravTrack"],
  request: { query: travTrackExportQuerySchema },
  responses: {
    200: {
      description: "The file",
      content: {
        "application/json": { schema: exportJson },
        "application/gpx+xml": { schema: z.string() },
      },
    },
    400: {
      description:
        "VALIDATION_FAILED, or TRAVTRACK_EXPORT_TOO_LONG: more than 366 days in one request",
      content: errorContent,
    },
    403: disabled,
  },
});
