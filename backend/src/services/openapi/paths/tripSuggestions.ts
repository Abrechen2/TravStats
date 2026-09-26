/**
 * The trip-suggestion inbox (owner decision 2026-09-26): one engine across
 * every readable domain proposes new trips, links to existing trips, trip
 * extensions and visits to own places. Nothing is stored but the answer.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { acceptBodySchema } from "../../../routes/tripSuggestions";

const badInput = { description: "Invalid input", content: errorContent };
const stale = {
  description: "`TRIP_SUGGESTION_STALE`: the suggestion changed or does not exist — reload",
  content: errorContent,
};
const tags = ["Trips"];
const day = z.string().describe("Local calendar day, YYYY-MM-DD");

const member = z.object({
  key: z.string().describe("`domain:id`"),
  domain: z.enum(["flight", "rail", "cruise", "lodging", "place", "roadtrip"]),
  id: z.string(),
  label: z.string(),
  startDay: day,
  endDay: day,
  planned: z.boolean(),
});

const suggestion = z.object({
  id: z.string().describe("Digest of kind, target and member set — changes when they do"),
  kind: z.enum(["new_trip", "assign", "extend", "place_visit"]),
  startDay: day,
  endDay: day,
  nights: z.number().int().nullable().describe("Nights away; null for a place visit"),
  planned: z.boolean().describe("Every member is still ahead"),
  destination: z.string().nullable(),
  signals: z.array(z.enum(["pnr", "home_loop", "continuity"])),
  members: z.array(member),
  trip: z
    .object({
      id: z.string(),
      name: z.string(),
      startDay: day.nullable(),
      endDay: day.nullable(),
    })
    .optional(),
  newSpan: z.object({ startDay: day, endDay: day }).optional(),
  place: z.object({ id: z.string(), name: z.string() }).optional(),
  anchor: z
    .object({
      key: z.string(),
      domain: member.shape.domain,
      label: z.string(),
      tripId: z.string().nullable(),
    })
    .optional(),
  distanceM: z.number().int().optional(),
});

registry.registerPath({
  method: "get",
  path: "/trip-suggestions",
  summary: "Trip suggestions across every domain",
  description:
    "An absence from home becomes a `new_trip` with at least one night away and two trip-less " +
    "entries; trip-less entries inside (±1 day) an existing trip become `assign`, those stretching " +
    "it `extend` (with `newSpan`); an own place within 1 km of a stay, port or station with no " +
    "visit then becomes `place_visit`. Answered proposals stay gone until their member set changes " +
    "by more than half. Rail and roadtrip entries appear only while the instance shows them. " +
    "`home` says how home was known: `history`, `estimated` (most-visited flown airport) or " +
    "`missing` (only flight-detected journeys can then be proposed).",
  tags,
  responses: {
    200: {
      description: "Up to 200 suggestions, newest first",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              suggestions: z.array(suggestion),
              total: z.number().int(),
              home: z.enum(["history", "estimated", "missing"]),
              truncated: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trip-suggestions/count",
  summary: "How many trip suggestions are open",
  tags,
  responses: {
    200: {
      description: "The inbox badge's number",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ count: z.number().int() }),
          }),
        },
      },
    },
  },
});

const idParam = z.object({ id: z.string().describe("The suggestion's id, URL-encoded") });

registry.registerPath({
  method: "post",
  path: "/trip-suggestions/{id}/accept",
  summary: "Accept a trip suggestion",
  description:
    "One transaction: creates the trip (or widens the existing one) and links every chosen " +
    "member, or records the visit — and the answer. A member that moved meanwhile rolls it all back.",
  tags,
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: acceptBodySchema } } },
  },
  responses: {
    200: {
      description: "What was created or linked",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              tripId: z.string().nullable(),
              placeVisitId: z.string().nullable(),
              linked: z.number().int(),
            }),
          }),
        },
      },
    },
    400: badInput,
    409: stale,
  },
});

registry.registerPath({
  method: "post",
  path: "/trip-suggestions/{id}/dismiss",
  summary: "Dismiss a trip suggestion",
  description: "Remembered: it does not come back unless its member set changes materially.",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "Dismissed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ dismissed: z.boolean() }),
          }),
        },
      },
    },
    409: stale,
  },
});
