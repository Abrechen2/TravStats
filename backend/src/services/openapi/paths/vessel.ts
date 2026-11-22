import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * The ship behind a ferry crossing or a cruise (2026-11-22),
 * `routes/vessel/vesselRoutes.ts`, mounted under both prefixes. Enveloped.
 */

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const params = z.object({ id: z.string().uuid() });
const errors = {
  400: { description: "Invalid input", content: errorContent },
  401: { description: "Authentication required", content: errorContent },
  403: { description: "Write scope required", content: errorContent },
  404: { description: "Entry not found or not owned", content: errorContent },
};
const SOURCES = ["catalogue", "wikidata", "aisstream", "manual"] as const;

const candidate = z.object({
  mmsi: z.string(),
  imo: z.string().nullable(),
  name: z.string(),
  operator: z.string().nullable(),
  source: z.enum(["catalogue", "wikidata", "aisstream"]),
});

const status = z.object({
  vesselName: z.string().nullable(),
  mmsi: z.string().nullable().describe("Resolved by the server, never typed"),
  source: z.enum(SOURCES).nullable().describe("null with an MMSI: bound before 2026-11-22"),
  confidence: z.enum(["high", "medium"]).nullable(),
  reason: z
    .enum(["ambiguous", "notFound", "unavailable", "noName"])
    .nullable()
    .describe("Why no MMSI could be resolved; an ambiguous ship is never guessed"),
  aisConfigured: z.boolean(),
  inProgress: z.boolean(),
  signal: z
    .enum(["notConfigured", "unresolved", "notInProgress", "ok", "outOfRange"])
    .describe("outOfRange: in progress, but no AIS position within the last 30 minutes"),
  lastFix: z
    .object({
      lat: z.number(),
      lon: z.number(),
      observedAt: z.string(),
      receivedAt: z.string(),
      speedKnots: z.number().nullable(),
      courseDegrees: z.number().nullable(),
    })
    .nullable(),
  track: z
    .object({
      coordinates: z.array(z.tuple([z.number(), z.number()])),
      distanceKm: z.number(),
      coversJourney: z.boolean(),
      firstAt: z.string(),
      lastAt: z.string(),
    })
    .nullable(),
});

for (const [prefix, tag] of [
  ["ferry", "Ferry"],
  ["cruises", "Cruises"],
] as const) {
  registry.registerPath({
    method: "get",
    path: `/${prefix}/{id}/vessel`,
    tags: [tag],
    summary: "The journey's ship: resolved MMSI, last AIS position, recorded track",
    description:
      "Resolves the MMSI from the ship's name (catalogue, then Wikidata) when none is bound; the AIS static-data step runs only in the poller during the voyage. Positions are recorded every ten minutes while the journey is in progress.",
    request: { params },
    responses: {
      200: { description: "Vessel status", content: json(envelope(status)) },
      ...errors,
    },
  });
  registry.registerPath({
    method: "get",
    path: `/${prefix}/{id}/vessel/candidates`,
    tags: [tag],
    summary: "Ships matching a name, for the manual assignment",
    request: { params, query: z.object({ q: z.string().min(2).max(100) }) },
    responses: {
      200: {
        description: "Candidates; status unavailable when the source did not answer",
        content: json(
          envelope(
            z.object({ status: z.enum(["ok", "unavailable"]), candidates: z.array(candidate) })
          )
        ),
      },
      ...errors,
      429: { description: "Rate limited" },
    },
  });
  registry.registerPath({
    method: "put",
    path: `/${prefix}/{id}/vessel`,
    tags: [tag],
    summary: "Bind a ship the server offered (never raw digits)",
    description:
      "The MMSI must be one of the candidates the server returned for `query`, or the journey's own lookup; otherwise 400 VESSEL_NOT_OFFERED. Drops positions recorded for a previous ship.",
    request: {
      params,
      body: {
        content: json(
          z.object({ mmsi: z.string().regex(/^\d{9}$/), query: z.string().max(100).optional() })
        ),
      },
    },
    responses: {
      200: {
        description: "Bound",
        content: json(envelope(z.object({ mmsi: z.string(), source: z.literal("manual") }))),
      },
      ...errors,
    },
  });
}
