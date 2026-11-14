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
  place: z
    .object({
      name: z.string(),
      lat: z.number().nullable().describe("Where the named place lies"),
      lon: z.number().nullable(),
      source: z
        .enum(["accepted", "fixed", "lodging"])
        .describe(
          "`accepted`: the owner accepted this name (`PUT /travtrack/stops/place`); `fixed`: a " +
            "fixed place of the account; `lodging`: a booked lodging. Precedence accepted > fixed > lodging"
        ),
      placeId: z.string().optional().describe("`FixedPlace.id` when `source` is `fixed`"),
      lodgingStayId: z.string().optional().describe("The stay when `source` is `lodging`"),
    })
    .nullable()
    .describe("The name of the stop: the owner's accepted one, else a fixed place or lodging"),
  dismissed: z
    .literal(true)
    .optional()
    .describe(
      "Present when the owner marked the stop as only a wait (`PUT /travtrack/stops/dismissed`); " +
        "absent otherwise. The stop is still listed so it can be restored; legs and figures are unchanged"
    ),
  openStart: z
    .literal(true)
    .optional()
    .describe(
      "Present when the stay began before this day: `fromMs` is then the day's start. Absent otherwise"
    ),
  openEnd: z
    .literal(true)
    .optional()
    .describe(
      "Present when the stay goes on past the end shown: past the day (`untilMs` is then the day's " +
        "end) or, on the current day, past the latest fix at a fixed place. Absent otherwise"
    ),
  folded: z
    .object({ fixCount: z.number().int() })
    .nullable()
    .describe(
      "Set when the stop is a run of fixes folded into a fixed place or a lodging; the day's " +
        "`segments` still carry every fix. Null when not folded"
    ),
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

const candidate = z.object({
  name: z.string(),
  type: z.string().nullable().describe("Picker category, e.g. `shopping`"),
  address: z.string().nullable(),
  city: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  distanceM: z.number().int(),
  photoCount: z.number().int().nullable().describe("Null without photo evidence"),
});
const geocoderState = z
  .enum(["ok", "empty", "degraded"])
  .describe("`degraded`: the geocoder FAILED, which is not the same as `empty` (no match)");

export const stopIdentitySchema = z.object({
  lat: z.number(),
  lon: z.number(),
  probable: z
    .object({
      name: z.string(),
      source: z.enum(["known", "nearbyPlace", "address", "photos"]),
      photoSupported: z.boolean(),
    })
    .nullable()
    .describe("`known`: one of the owner's own places or lodgings within 100 m"),
  known: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(["place", "lodging"]),
        distanceM: z.number().int(),
        lat: z.number(),
        lon: z.number(),
      })
    )
    .describe("The owner's own places and lodgings within 100 m, nearest first"),
  address: z
    .object({
      address: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
    })
    .nullable(),
  geocoder: geocoderState,
  candidates: z.array(candidate).describe("Up to five named places within 100 m, nearest first"),
  candidatesState: geocoderState,
  photos: z.object({
    state: z.string().describe("off, notConfigured, ok, or the Immich failure kind"),
    count: z.number().int(),
    cities: z.array(z.object({ name: z.string(), count: z.number().int() })),
    truncated: z.boolean(),
  }),
});

const stopPlaceBody = z.object({
  fromMs: z.number().int().describe("Start of the stop, epoch milliseconds"),
  untilMs: z.number().int().describe("End of the stop; at most two days after the start"),
  place: z
    .object({
      name: z.string(),
      lat: z.number().nullable().optional(),
      lon: z.number().nullable().optional(),
    })
    .nullable()
    .describe("The accepted place; null removes the name"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/stops/place",
  summary: "What a stop probably was",
  description:
    "The owner's own places and lodgings within 100 m first, then the nearest named places " +
    "(supermarkets and charging stations included), the address and, when switched on, the " +
    "photos of the stop. Asked per visible stop. A geocoder failure answers 200 with " +
    "`geocoder` / `candidatesState` = `degraded`, never an empty success. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: {
    query: z.object({
      lat: z.number().describe("The stop's anchor latitude"),
      lon: z.number().describe("The stop's anchor longitude"),
      fromMs: z.number().int(),
      untilMs: z.number().int(),
    }),
  },
  responses: {
    200: {
      description: "The stop's identity",
      content: { "application/json": { schema: stopIdentitySchema } },
    },
    400: { description: "TRAVTRACK_STOP_INVALID: a bad position or span", content: errorContent },
    401: { description: "Not signed in", content: errorContent },
    403: { description: "TRAVTRACK_DISABLED", content: errorContent },
    429: { description: "Too many lookups", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/stops/place",
  summary: "Accept a name for a stop, or remove it",
  description:
    "Bound to the span, not to a stop: it applies to every derived stop it covers by more " +
    "than half. Answers the recomputed stop, bare. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: stopPlaceBody } } } },
  responses: {
    200: {
      description: "The recomputed stop",
      content: { "application/json": { schema: stopSchema } },
    },
    400: { description: "TRAVTRACK_STOP_INVALID: a bad span or name", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: { description: "TRAVTRACK_STOP_NOT_FOUND: no stop under the span", content: errorContent },
  },
});

const stopDismissBody = z.object({
  fromMs: z.number().int().describe("Start of the stop, epoch milliseconds"),
  untilMs: z.number().int().describe("End of the stop; at most two days after the start"),
  dismissed: z.boolean().describe("true: only a wait; false: restore the stop"),
});

registry.registerPath({
  method: "put",
  path: "/travtrack/stops/dismissed",
  summary: "Dismiss a stop as only a wait, or restore it",
  description:
    "Bound to the span, not to a stop: it applies to every derived stop it covers by more " +
    "than half, so a late point does not lose it. The stop stays in the day view, flagged " +
    "`dismissed`; points, legs and totals never change. Repeating the request is harmless. " +
    "Answers the recomputed stop, bare. Only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: stopDismissBody } } } },
  responses: {
    200: {
      description: "The recomputed stop",
      content: { "application/json": { schema: stopSchema } },
    },
    400: { description: "TRAVTRACK_STOP_INVALID: a bad span", content: errorContent },
    401: { description: "Not signed in", content: errorContent },
    403: {
      description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
      content: errorContent,
    },
    404: { description: "TRAVTRACK_STOP_NOT_FOUND: no stop under the span", content: errorContent },
    429: { description: "Too many requests", content: errorContent },
  },
});
