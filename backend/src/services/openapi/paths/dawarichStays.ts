import { z } from "zod";
import { timeValueSchema } from "../../../shared/time/wire";
import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import { errorContent } from "./shared";
import { jobStartedSchema } from "./jobs";
import { stayReviewSchema } from "../../../schemas/dawarichStays";
const scanTimes = z.object({
  startedAt: timeValueSchema.nullable(),
  finishedAt: timeValueSchema.nullable(),
  leaseUntil: timeValueSchema.nullable(),
  dataThrough: timeValueSchema.nullable(),
  windowStart: timeValueSchema.nullable(),
  windowEnd: timeValueSchema.nullable(),
});
const tags = ["Dawarich"];
const failure = {
  description: "Invalid input, inaccessible finding, absent connection, or concurrent operation",
  content: errorContent,
};
const stay = z.object({
  times: z.object({
    startAt: timeValueSchema.nullable(),
    endAt: timeValueSchema.nullable(),
    sourceStartAt: timeValueSchema.nullable(),
    sourceEndAt: timeValueSchema.nullable(),
    detectedAt: timeValueSchema.nullable(),
    resolvedAt: timeValueSchema.nullable(),
  }),
  ...prismaColumns("DawarichStay"),
  visit: z.object({ id: z.string(), placeId: z.string() }).nullable().optional(),
});
const response = (schema: z.ZodTypeAny) => ({
  description: "Account-scoped result",
  content: { "application/json": { schema: z.object({ success: z.literal(true), data: schema }) } },
});
registry.registerPath({
  method: "get",
  path: "/dawarich-stays",
  tags,
  summary: "Own location-history suggestions and retained decisions",
  description:
    "Conservative stationary clusters; not proof of GPS measurement or overnight accommodation. Original evidence and corrected times remain separate. Up to 200 most recent rows per status. `covered` lists findings resolved because a recorded place visit or lodging stay already holds them (within 250 m, a visit clock within 2 h or on the same local day); `evidence.coveredBy` names that record. Reading `pending` resolves newly covered findings first.",
  request: {
    query: z.object({ status: z.enum(["pending", "accepted", "rejected", "covered"]).optional() }),
  },
  responses: { 200: response(z.array(stay)) },
});
registry.registerPath({
  method: "get",
  path: "/dawarich-stays/settings",
  tags,
  summary: "Consent, own-connection availability and persistent last scan outcome",
  responses: {
    200: response(
      z
        .object({
          ...prismaColumns("DawarichStayScan"),
          times: scanTimes,
          connected: z.boolean(),
          placesEnabled: z.boolean(),
          pausedReason: z.enum(["disabled", "placesDisabled", "connectionMissing"]).nullable(),
          nextScanAt: z.string().datetime().nullable(),
          result: z.string().nullable(),
        })
        .partial()
    ),
  },
});
registry.registerPath({
  method: "patch",
  path: "/dawarich-stays/settings",
  tags,
  summary: "Explicit per-account opt-in, separate from Immich and country days",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              enabled: z.boolean().optional(),
              marketEnabled: z.boolean().optional(),
              venueEnabled: z.boolean().optional(),
            })
            .strict()
            .refine(
              (v) =>
                v.enabled !== undefined ||
                v.marketEnabled !== undefined ||
                v.venueEnabled !== undefined
            ),
        },
      },
    },
  },
  responses: {
    200: response(z.object({ ...prismaColumns("DawarichStayScan"), times: scanTimes })),
    409: failure,
  },
});
registry.registerPath({
  method: "post",
  path: "/dawarich-stays/scan",
  tags,
  summary: "Start a bounded asynchronous scan, optionally including opted-in market discovery",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ lookbackDays: z.number().int().min(1).max(30).default(7) }).strict(),
        },
      },
    },
  },
  description:
    "Requires opt-in, the Places domain and the user's own connection. Hiding Places pauses scans without deleting consent or findings. A cross-process lease excludes overlapping scans; errors and partial upstream results remain visible. Scheduled scans run every six hours at :15 UTC. Market discovery requires separate consent: approximate grid regions are sent to Overpass, never point sequences, times or ids. Public map data is cached; missing/failed coverage remains visible. Only confirmation creates a visit.",
  responses: {
    202: {
      description: "Poll /jobs/{jobId}",
      content: { "application/json": { schema: jobStartedSchema } },
    },
    409: failure,
    429: failure,
  },
});
registry.registerPath({
  method: "get",
  path: "/dawarich-stays/choices",
  tags,
  summary: "Own places and trips for reviewing a finding",
  description:
    "At most 2000 places (by name) and 500 trips (newest first); `q` narrows both by name, and `truncated` says when a list was cut.",
  request: { query: z.object({ q: z.string().max(200).optional() }) },
  responses: {
    200: response(
      z.object({
        places: z.array(
          z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number() })
        ),
        trips: z.array(z.object({ id: z.string(), name: z.string() })),
        truncated: z.object({ places: z.boolean(), trips: z.boolean() }),
      })
    ),
  },
});
registry.registerPath({
  method: "post",
  path: "/dawarich-stays/{id}/accept",
  tags,
  summary: "Confirm a corrected stay, reusing or creating one visit atomically",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: stayReviewSchema } } },
  },
  responses: { 200: response(stay), 400: failure, 404: failure, 409: failure, 422: failure },
});
registry.registerPath({
  method: "post",
  path: "/dawarich-stays/{id}/reject",
  tags,
  summary: "Dismiss a finding and retain it for subsequent deduplication",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Dismissed",
      content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
    },
    404: failure,
    409: failure,
  },
});
