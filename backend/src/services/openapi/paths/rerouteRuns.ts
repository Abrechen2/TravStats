/**
 * The bulk re-route of a roadtrip's legs (forgejo#436), split out of
 * `./tours.ts` which sits at the 800-line limit. The administrator's own
 * endpoints are not documented here: `/admin` is out of the spec's scope.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { registerSectionPath, routeIdParams } from "./tours";

const rerouteRun = registry.register(
  "RerouteRun",
  z.object({
    id: z.string().uuid(),
    scope: z.enum(["instance", "roadtrip"]),
    routeId: z.string().uuid().nullable(),
    mode: z.enum(["straight", "all"]).describe("`all` routes lines already routed again too"),
    status: z
      .enum(["running", "paused", "done", "cancelled", "failed"])
      .describe("`paused` means the provider's daily quota was reached; the next UTC day resumes"),
    total: z.number().int(),
    processed: z.number().int(),
    routed: z.number().int().describe("Lines written"),
    kept: z.number().int().describe("Tried and left as stored; the reason is in failureCounts"),
    failureCounts: z
      .record(z.string(), z.number().int())
      .describe(
        "Per reason: a route-fallback reason (`no_route`, `rate_limited`, …), `timeout`, " +
          "`no_coordinates` or `changed` (the row was edited while the provider answered)"
      ),
    failureSample: z.array(z.object({ kind: z.string(), id: z.string(), reason: z.string() })),
    stopReason: z.string().nullable(),
    resumeAfter: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
);
const runBody = z.object({ run: rerouteRun });

registerSectionPath({
  method: "post",
  path: "/trips/{id}/routes/{routeId}/reroute-all",
  summary: "Route every line of a section again, as a resumable run",
  description:
    "Starts a run over this section's road, foot and bike legs that are straight or were " +
    "routed before; a drawn or recorded line is never replaced and a failed answer keeps the " +
    "stored line. Poll `GET /routing-runs/{id}`. The run draws on the caller's own share of " +
    "the daily routing quota and pauses, with a cursor, when it is spent.",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    202: {
      description: "The run was started",
      content: { "application/json": { schema: runBody } },
    },
    404: { description: "Trip or section not found", content: errorContent },
    409: {
      description: "`notConfigured` (no routing provider) or `alreadyActive` (with the run)",
      content: errorContent,
    },
  },
});

registerSectionPath({
  method: "get",
  path: "/trips/{id}/routes/{routeId}/reroute-all",
  summary: "The latest re-route run of a section",
  tags: ["Tours"],
  request: { params: routeIdParams },
  responses: {
    200: {
      description: "The latest run, or null when none was ever started",
      content: { "application/json": { schema: z.object({ run: rerouteRun.nullable() }) } },
    },
    404: { description: "Trip or section not found", content: errorContent },
  },
});

const runParams = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: "get",
  path: "/routing-runs/{id}",
  summary: "Progress of a re-route run the caller started",
  tags: ["Tours"],
  request: { params: runParams },
  responses: {
    200: { description: "The run", content: { "application/json": { schema: runBody } } },
    404: { description: "No such run for this account", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/routing-runs/{id}/cancel",
  summary: "Cancel a re-route run",
  description:
    "Takes effect before the next line; lines already written stay. A run that is over is returned as it is.",
  tags: ["Tours"],
  request: { params: runParams },
  responses: {
    200: { description: "The run", content: { "application/json": { schema: runBody } } },
    404: { description: "No such run for this account", content: errorContent },
  },
});
