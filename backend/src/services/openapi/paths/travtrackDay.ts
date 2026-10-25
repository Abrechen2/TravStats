import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackDayQuerySchema, travTrackExportQuerySchema } from "../../../schemas/travtrack";
import { GAP_REASONS } from "../../travtrack/limits";
import { DOMAIN_KEYS } from "../../../shared/domains";

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
        kind: z
          .enum([...DOMAIN_KEYS, "trip", "home", "suggestion", "movement"])
          .describe(
            "A domain's entry (every domain with an entry-window adapter), a trip, time at " +
              "home, an open TravTrack question, or a moving stretch no entry covers"
          ),
        id: z
          .string()
          .nullable()
          .describe("The entry, trip or question; null for home and movement"),
        label: z.string().describe("The record's own name; empty when it has none"),
        href: z
          .string()
          .nullable()
          .describe("The web path the label opens: the entry's page or the question's inbox card"),
        anchor: z
          .object({ lat: z.number(), lon: z.number() })
          .nullable()
          .describe(
            "Where the label sits on the map: the record's own pin or the first privacy-safe " +
              "vertex of its stretch; null rather than a point inside a privacy circle"
          ),
        unlabelled: z
          .boolean()
          .describe("A moving stretch (≥ 2 km) no entry covers; never carries a guessed mode"),
        suggestion: z.enum(["stay", "journey"]).optional().describe("On a `suggestion`: which"),
      })
    )
    .describe(
      "What TravStats knows of the day, from its own records: every visible domain's entries, " +
        "trips, stretches within 300 m of home, the open TravTrack questions and the unlabelled " +
        "moving stretches"
    ),
  pointCount: z.number().int(),
  truncated: z.boolean().describe("More points than one day answer carries"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/day",
  summary: "One day of the TravTrack history",
  description:
    "On the profile clock: the lines, what the phone did and did not record, and the day " +
    "labelled from TravStats — its entries, trips, home stretches, open TravTrack questions and " +
    "the moving stretches no entry covers. Only while TravTrack is on.",
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
