import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * TravTrack, the own location history (TravTrack plan, phase 2):
 * `routes/travtrack.ts` and `routes/travtrack/*`. Bare.
 *
 * Every route names a gate tier (`routes/travtrack/gate.ts`); a refusal by the
 * gate is 403 `TRAVTRACK_DISABLED`.
 */

const capabilities = z.object({
  version: z.literal(1),
  offered: z.boolean().describe("The beta switch offers TravTrack on this server"),
  enabled: z.boolean().describe("The instance captures and shows TravTrack (beta + config)"),
  active: z.boolean().describe("This account's location provider is TravTrack and it works"),
  hasData: z
    .boolean()
    .describe("This account holds TravTrack data: summary, export and delete stay reachable"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/capabilities",
  summary: "What TravTrack does on this server for this account",
  description:
    "Answers whatever the switches say, read-only tokens included: it is how a client learns " +
    "that TravTrack is off instead of meeting a refusal on every call.",
  tags: ["TravTrack"],
  responses: {
    200: {
      description: "The switches as they stand",
      content: { "application/json": { schema: capabilities } },
    },
    401: { description: "No session", content: errorContent },
  },
});

const config = z.object({
  enabled: z.boolean().describe("TravTrack's instance switch (effective with the beta switch)"),
});

registry.registerPath({
  method: "get",
  path: "/travtrack/config",
  summary: "TravTrack's instance switch",
  description:
    "Admin only. Reachable while the beta switch is on, whether or not TravTrack itself is on.",
  tags: ["TravTrack"],
  responses: {
    200: { description: "The switch", content: { "application/json": { schema: config } } },
    403: {
      description: "Not an admin, or TRAVTRACK_DISABLED (beta switch off)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/travtrack/config",
  summary: "Switch TravTrack on or off for this server",
  description:
    "Admin only, write scope. Switching off stops capture and the views; nothing is deleted, " +
    "and accounts holding data keep their summary, export and delete.",
  tags: ["TravTrack"],
  request: { body: { content: { "application/json": { schema: config.strict() } } } },
  responses: {
    200: { description: "The switch now", content: { "application/json": { schema: config } } },
    400: { description: "VALIDATION_FAILED", content: errorContent },
    403: {
      description: "Not an admin, a token without admin scope, or TRAVTRACK_DISABLED",
      content: errorContent,
    },
  },
});
