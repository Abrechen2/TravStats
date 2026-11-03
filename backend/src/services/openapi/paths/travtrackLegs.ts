import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { LEG_MODES } from "../../travtrack/legs/types";

/**
 * TravTrack's legs and stops (spec 2026-11-03-travtrack-legs): the shapes the
 * day view carries, the readings and aggregates the day and range views gain,
 * and the mode correction. Beside `travtrackDay.ts`, which imports them.
 */

const mode = z.enum(LEG_MODES);

export const legSchema = z.object({
  id: z.string().describe("`${fromMs}-${untilMs}`: stable for the same points"),
  fromMs: z.number().int(),
  untilMs: z.number().int(),
  mode: mode.describe("`unknown` where the evidence does not agree: never a guess"),
  modeSource: z
    .enum(["auto", "entry", "manual"])
    .describe("The owner's correction, a logbook entry covering the leg, or the phone's motion"),
  confidence: z.enum(["high", "low"]).describe("Auto only can be low; entry and manual are high"),
  entryRef: z
    .object({ domain: z.string(), id: z.string() })
    .nullable()
    .describe("The covering entry, when `modeSource` is `entry`"),
  distanceM: z.number().int(),
  durationMs: z.number().int(),
  movingMs: z.number().int().nullable().describe("Null when no step could be measured"),
  avgSpeedMps: z.number().nullable(),
  maxSpeedMps: z.number().nullable().describe("The everyday top speed, spike rule applied"),
  ascentM: z.number().int().nullable().describe("Null without believable altitudes"),
  descentM: z.number().int().nullable(),
  bounds: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .describe("`[west, south, east, north]`"),
  ranges: z
    .array(z.object({ segment: z.number().int(), from: z.number().int(), to: z.number().int() }))
    .describe("Vertex index ranges into the day's `segments`, inclusive"),
});

export const stopSchema = z.object({
  fromMs: z.number().int(),
  untilMs: z.number().int(),
  anchor: z.object({ lat: z.number(), lon: z.number() }),
  stayRef: z
    .object({ id: z.string(), status: z.string() })
    .nullable()
    .describe("A TravTrack stay question this dwell belongs to, if any"),
});

export const pointDetailSchema = z.object({
  speedMps: z.number().nullable(),
  altitudeM: z.number().nullable(),
  motion: z.string().nullable().describe("The phone's movement class as stored"),
});

export const aggregatesSchema = z.object({
  distanceM: z.number().int().describe("Ground distance of this part, from the stored points"),
  movingMs: z.number().int().nullable().describe("Null when no step could be measured"),
  maxSpeedMps: z.number().nullable(),
});

const modeBody = z.object({
  fromMs: z.number().int().describe("Start of the span, epoch milliseconds"),
  untilMs: z.number().int().describe("End of the span; at most two days after the start"),
  mode: mode.nullable().describe("The corrected mode; null resets the span to automatic"),
});

registry.registerPath({
  method: "put",
  path: "/travtrack/legs/mode",
  summary: "Correct a leg's mode, or reset it",
  description:
    "The correction is bound to the span, not to a leg id, and applies to every derived leg " +
    "it covers by more than half its duration. Answers the recomputed leg, bare. Only while " +
    "TravTrack is on.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: modeBody } } } },
  responses: {
    200: {
      description: "The recomputed leg",
      content: { "application/json": { schema: legSchema } },
    },
    400: { description: "TRAVTRACK_LEG_INVALID: a bad span or mode", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: { description: "TRAVTRACK_LEG_NOT_FOUND: no leg under the span", content: errorContent },
  },
});
