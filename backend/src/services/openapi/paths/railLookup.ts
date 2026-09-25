/**
 * Rail station catalogue and train-number lookup (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md, phase 2). Enveloped like
 * the rest of the rail family.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { RAIL_LOOKUP_OUTCOMES, RAIL_LOOKUP_PROVIDERS } from "../../rail/lookup/types";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

const railStation = registry.register(
  "RailStation",
  z
    .object({
      id: z.number().int(),
      name: z.string(),
      uic: z.string().nullable().describe("UIC station code"),
      dbId: z.string().nullable().describe("Deutsche Bahn EVA number, not the UIC code"),
      lat: z.number(),
      lon: z.number(),
      country: z.string().nullable().describe("ISO 3166-1 alpha-2"),
      timezone: z.string().nullable().describe("IANA zone, from the catalogue"),
    })
    .openapi("RailStation")
);

const lookupStop = z.object({
  name: z.string().describe("As the provider names it"),
  lat: z.number(),
  lon: z.number(),
  stationId: z.number().int().nullable().describe("Catalogue row within 300 m, if any"),
  code: z.string().nullable(),
  country: z.string().nullable(),
  arrivalLocal: z
    .string()
    .nullable()
    .describe("Planned arrival on the stop's own clock, YYYY-MM-DDTHH:mm"),
  departureLocal: z.string().nullable(),
});

const lookupAnswer = z
  .object({
    match: z
      .object({
        provider: z.enum(RAIL_LOOKUP_PROVIDERS),
        ref: z.string().describe("The provider's trip id; send it back as `lookup.ref`"),
        operator: z.string().nullable(),
        trainCategory: z.string().nullable(),
        trainNumber: z.string().nullable(),
        stops: z.array(lookupStop),
        boardingIndex: z.number().int().describe("Index of the stop nearest the boarding station"),
        hasGeometry: z.boolean().describe("Whether the provider traces the trip's line"),
      })
      .nullable(),
    attempts: z.array(
      z.object({ provider: z.enum(RAIL_LOOKUP_PROVIDERS), outcome: z.enum(RAIL_LOOKUP_OUTCOMES) })
    ),
  })
  .openapi("RailLookupAnswer");

registry.registerPath({
  method: "get",
  path: "/rail/stations",
  summary: "Search the rail station catalogue",
  description:
    "Typeahead over the vendored station catalogue (Trainline stations.csv, ODbL 1.0). " +
    "Seven or eight digits match a UIC or EVA code exactly; anything else must contain " +
    "every word of the query at the start of a word, diacritics folded. Names that start " +
    "with the query come first, then rows carrying a rail code.",
  tags: ["Rail"],
  request: {
    query: z.object({
      q: z.string().min(2).max(100),
      limit: z.coerce.number().int().min(1).max(50).optional().describe("Default 20"),
    }),
  },
  responses: {
    200: {
      description: "Matching stations",
      content: { "application/json": { schema: envelope(z.array(railStation)) } },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Too many searches", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rail/lookup",
  summary: "Look a train up by number and day",
  description:
    "Asks Transitous, then (for German stations) db-rest, for the train with this number " +
    "leaving the boarding station on that day, read on the station's clock. Nothing is " +
    "stored. An answer for another day is discarded: both services know only their " +
    "current timetable, so a past day usually has no match. `attempts` says per provider " +
    "whether it matched, found nothing, did not answer, was switched off by the admin, " +
    "or does not cover the station.",
  tags: ["Rail"],
  request: {
    query: z.object({
      trainNumber: z.string().max(30).describe("'ICE 578' or '578'"),
      category: z.string().max(10).optional().describe("'ICE', narrows a shared number"),
      date: z.string().describe("YYYY-MM-DD, the day on the boarding station's clock"),
      fromStationId: z.coerce.number().int().optional().describe("Catalogue row"),
      fromLat: z.coerce.number().optional().describe("Without a catalogue row"),
      fromLon: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      description: "The match, if any, and what each provider did",
      content: { "application/json": { schema: envelope(lookupAnswer) } },
    },
    400: { description: "Invalid query or unknown station", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    429: { description: "Too many lookups", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rail/lookup/providers",
  summary: "Which lookup providers this instance may ask",
  tags: ["Rail"],
  responses: {
    200: {
      description: "The admin's switches",
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              transitous: z.boolean(),
              dbRest: z.boolean(),
              transitousSourcesUrl: z.string().url().describe("Credit link Transitous asks for"),
            })
          ),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});
