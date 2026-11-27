import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * The optional cleanup of a sparse or noisy TravTrack day (rc46 extras C):
 * smoothing as a drawing choice and road matching through the admin's own
 * router. Raw points never change; the day view carries the result in
 * `cleanup`.
 */

const tags = ["TravTrack"];
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const failure = { description: "Failure with a stable `code` and `reason`", content: errorContent };
const disclosure = z.object({
  serviceId: z.literal("mapMatching"),
  host: z.string(),
  provider: z.enum(["valhalla", "graphhopper"]),
  location: z.enum(["cloud", "lan"]),
  fields: z.array(z.string()),
  pointCount: z.number().int(),
  privacyZonesApplied: z.boolean(),
});
const matchSchema = z.object({
  id: z.string(),
  fromMs: z.number().int(),
  untilMs: z.number().int(),
  lines: z.array(z.array(z.tuple([z.number(), z.number()]))),
  confidence: z.number(),
  provider: z.string().describe("The router's host"),
  pointCount: z.number().int(),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/cleanup/availability",
  summary: "Whether road matching can be offered",
  description:
    "Available only while the admin switched the catalogue entry `mapMatching` on (off by default), entered a router address (none is preset) and the internet switch is on.",
  tags,
  responses: {
    200: {
      description: "The road-matching gate",
      content: json(
        z.object({
          mapMatching: z.object({
            available: z.boolean(),
            reason: z.enum(["serviceOff", "notConfigured", "internetOff"]).nullable(),
          }),
        })
      ),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/cleanup/smoothing",
  summary: "Switch the drawing-only smoothing for the account or one day",
  description:
    "Smoothing (a speed-gated moving median) applies only to stretches of a source scoring below the day's threshold and only to what is drawn; off by default.",
  tags,
  request: {
    body: {
      content: json(
        z.union([
          z.object({ scope: z.literal("global"), enabled: z.boolean() }),
          z.object({ scope: z.literal("day"), date: z.string(), enabled: z.boolean() }),
        ])
      ),
    },
  },
  responses: {
    200: {
      description: "The stored choice",
      content: json(z.object({ scope: z.enum(["global", "day"]), enabled: z.boolean() })),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/cleanup/match",
  summary: "Match one stretch (at most a day) to roads through the admin's router",
  description:
    "Only the stretch's privacy-safe points are sent, privacy zones cut out right before the request. Without a confirmation for the current router (`engine@host`) the answer is 409 `CONFIRMATION_REQUIRED` with `disclosure`, and nothing is sent. A match below the confidence threshold is not stored (422 `lowConfidence`). Failures answer `MAP_MATCH_FAILED` with `reason`: 409 setup (`serviceOff`, `notConfigured`, `internetOff`, `privateTarget`, `invalidUrl`), 422 (`tooFewPoints`, `tooLarge`, `lowConfidence`), 502 (`unreachable`, `badResponse`), 504 (`timeout`).",
  tags,
  request: {
    body: {
      content: json(
        z.object({
          fromMs: z.number().int(),
          untilMs: z.number().int(),
          confirmation: z
            .object({ mode: z.enum(["once", "always"]), target: z.string() })
            .optional(),
        })
      ),
    },
  },
  responses: {
    201: {
      description: "The stored match, labelled 'an Straßen angepasst'",
      content: json(matchSchema),
    },
    409: {
      description: "Confirmation required (with `disclosure`) or a setup refusal",
      content: json(
        z.object({ error: z.string(), code: z.string(), disclosure: disclosure.optional() })
      ),
    },
    422: failure,
    502: failure,
    504: failure,
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/cleanup/match/{id}",
  summary: "Undo a road match",
  tags,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Removed; the stretch draws as recorded again" },
    404: { description: "No such match of this account", content: errorContent },
  },
});

// ---- "Als Roadtrip übernehmen" (rc46 extras A) -----------------------------------
const station = z.object({
  key: z.string(),
  kind: z.enum(["start", "stop", "end"]),
  name: z.string().nullable().describe("The user's place there, else the stop's accepted name"),
  nameSource: z.enum(["place", "stop", "suggestion"]).nullable(),
  placeId: z.string().nullable().describe("The user's place within 200 m, linked on save"),
  lat: z.number(),
  lon: z.number(),
  arriveMs: z.number().int().nullable(),
  departMs: z.number().int().nullable(),
  dwellMs: z.number().int().nullable(),
});
registry.registerPath({
  method: "get",
  path: "/travtrack/roadtrip-preview",
  summary: "Stations and line a roadtrip would get from a recorded span",
  description:
    "A leg (`fromMs`/`untilMs`) or days on the profile clock (`fromDay`/`toDay`, inclusive, at most 14). Stations are the span's first and last fix and every stop of at least 15 minutes not dismissed as a wait, from the same privacy-safe derivation the day view draws. Each leg's line is the recorded fixes (at most 256 vertices, the drawn-leg limit); a chord across a recording gap is listed in `estimated` and its kilometres in `estimatedKm`. Reads only. Failures answer `TRAVTRACK_ROADTRIP_PREVIEW_FAILED` with `reason` (`tooLong` 400; `noPoints`, `truncated`, `tooFewStations` 422).",
  tags,
  request: {
    query: z.object({
      fromDay: z.string().optional(),
      toDay: z.string().optional(),
      fromMs: z.number().int().optional(),
      untilMs: z.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "The preview",
      content: json(
        z.object({
          stations: z.array(station),
          legs: z.array(
            z.object({
              fromKey: z.string(),
              toKey: z.string(),
              coordinates: z.array(z.tuple([z.number(), z.number()])),
              estimated: z.array(z.array(z.tuple([z.number(), z.number()]))),
              distanceKm: z.number(),
              estimatedKm: z.number(),
            })
          ),
          distanceKm: z.number(),
          estimatedKm: z.number(),
          zone: z.string().describe("The profile zone the stations' days are read on"),
        })
      ),
    },
    400: failure,
    422: failure,
  },
});
