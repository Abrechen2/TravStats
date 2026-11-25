import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackRangeQuerySchema } from "../../../schemas/travtrack";
import {
  daySourceChoiceSchema,
  daySourceDateSchema,
  questionableDaysQuerySchema,
} from "../../../schemas/travtrackDaySources";

/** Best source per day (`services/travtrack/bestSource/`). */

const disabled = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};
const span = { fromMs: z.number().int(), untilMs: z.number().int() };
const kind = z.enum(["flight", "rail", "bus", "ferry"]);

export const bridgeSchema = z.object({
  ...span,
  kind,
  entryId: z.string(),
  reason: z.enum(["jump", "gap"]).describe("What the entry explains: a jump or a long silence"),
});

export const daySourceSummarySchema = z
  .object({
    scored: z.boolean().describe("false: the paced derivation has not resolved the day yet"),
    sources: z.array(
      z.object({
        source: z.string().describe("The stored origin (`companion:…`, `gpx:…`, …)"),
        kind: z.enum(["phone", "dawarich", "import", "other"]),
        score: z.number().describe("Quality 0..1"),
        points: z.number().int(),
        accuracyKnownShare: z.number().describe("Share of points that carry an accuracy"),
      })
    ),
    segments: z.array(z.object({ ...span, source: z.string() })),
    override: z.string().nullable().describe("The user's choice for the whole day, or null"),
    mixed: z.boolean().describe("More than one source on the day"),
    bestScore: z.number().nullable(),
    outliers: z.object({
      count: z.number().int(),
      decision: z.enum(["discard", "keep"]).nullable(),
    }),
    bridges: z.array(bridgeSchema),
    breaks: z.array(z.tuple([z.number(), z.number()])),
    clockOffset: z
      .object({ source: z.string(), relativeTo: z.string(), offsetS: z.number().int() })
      .nullable()
      .describe("A constant clock offset seen between two sources; reported, never applied"),
    truncated: z.boolean(),
    questionable: z.boolean(),
  })
  .describe("Which source the day is drawn and counted from, and why");

const questionable = z.object({
  total: z.number().int(),
  days: z.array(
    z.object({
      date: z.string(),
      reasons: z.array(z.enum(["lowScore", "mixed", "outliers"])),
      bestScore: z.number(),
      outlierCount: z.number().int(),
      sources: z.array(z.string()),
    })
  ),
});

const preview = z.object({
  points: z.number().int(),
  days: z.array(
    z.object({
      date: z.string(),
      points: z.number().int(),
      sources: z.record(z.string(), z.number().int()),
    })
  ),
});

const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/day-sources/questionable",
  summary: "Days with questionable tracks",
  description: "Days with a low quality score, mixed sources or open outliers, newest first.",
  tags: ["TravTrack"],
  request: { query: questionableDaysQuerySchema },
  responses: { 200: json(questionable, "The days"), 403: disabled },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/day-sources/{date}",
  summary: "The sources of one day",
  tags: ["TravTrack"],
  request: { params: z.object({ date: daySourceDateSchema }) },
  responses: {
    200: json(daySourceSummarySchema, "The day's sources"),
    400: { description: "VALIDATION_FAILED: not a day", content: errorContent },
    403: disabled,
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/day-sources/{date}",
  summary: "Choose a day's source or decide on its outliers",
  description: "Stores the choice and re-derives that day only. Raw points are never changed.",
  tags: ["TravTrack"],
  request: {
    params: z.object({ date: daySourceDateSchema }),
    body: { content: { "application/json": { schema: daySourceChoiceSchema } } },
  },
  responses: {
    200: json(daySourceSummarySchema, "The day's sources after the choice"),
    400: {
      description: "TRAVTRACK_SOURCE_NOT_ON_DAY or VALIDATION_FAILED",
      content: errorContent,
    },
    404: { description: "TRAVTRACK_DAY_NO_POINTS", content: errorContent },
    403: disabled,
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/points/delete-preview",
  summary: "What a range delete would remove",
  description: "Points per profile day and source in the span; nothing is removed.",
  tags: ["TravTrack"],
  request: { query: travTrackRangeQuerySchema },
  responses: {
    200: json(preview, "The preview"),
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: disabled,
  },
});
