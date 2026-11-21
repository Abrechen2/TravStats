import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/**
 * "Fotos auswählen" for place visits and entries, and the per-visit limit with
 * its trim pass (owner, 2026-11-21).
 */
const tags = ["Places", "Entry photos"];
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };
const provider = z.enum(["immich", "photoprism"]);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

const choice = z.object({
  provider,
  assetId: z.string(),
  url: z.string().describe("Where the thumbnail is served"),
  takenAt: z.string().nullable(),
  distanceM: z.number().nullable().describe("Metres to the place; null when unknown"),
  chosen: z.boolean(),
  provenance: z.enum(["manual", "auto"]).nullable(),
  refused: z.boolean().describe("The user removed it earlier"),
});
const choices = z.object({
  choices: z.array(choice),
  sources: z.record(z.string(), z.string()),
  untimed: z.boolean().optional(),
  cap: z.number(),
  openIn: z
    .array(z.object({ provider, url: z.string() }))
    .describe("Links into the source's own UI; empty without a browsable base URL"),
});
const pick = z.object({ provider, assetId: z.string() });
const change = z.object({
  select: z.array(pick).max(100).optional().describe("Become the user's own picks"),
  deselect: z
    .array(pick)
    .max(100)
    .optional()
    .describe("An automatic one replaced by a pick is dropped quietly; the rest become refusals"),
});
const saved = z.object({
  picked: z.number(),
  swapped: z.number(),
  refused: z.number(),
  skipped: z.number(),
});
const jobId = envelope(z.object({ jobId: z.string() }));

for (const [path, params] of [
  ["/places/visits/{visitId}/photo-choices", z.object({ visitId: z.string().uuid() })],
  [
    "/entry-photos/{kind}/{entryId}/photo-choices",
    z.object({ kind: z.string(), entryId: z.string().uuid() }),
  ],
] as const) {
  registry.registerPath({
    method: "get",
    path,
    summary: "Every candidate photo, the linked ones ticked",
    tags,
    request: { params },
    responses: {
      200: { description: "The candidates", content: json(envelope(choices)) },
      404: notFound,
    },
  });
  registry.registerPath({
    method: "put",
    path,
    summary: "Save the user's choice among the candidates",
    tags,
    request: { params, body: { content: json(change) } },
    responses: {
      200: { description: "What changed", content: json(envelope(saved)) },
      400: badInput,
      404: notFound,
    },
  });
}

registry.registerPath({
  method: "put",
  path: "/places/visits/photos/auto-link/cap",
  summary: "Set the automatic-link limit (5–10) and trim to it",
  description: "Starts the trim job (`jobId`); its result is `{trimmed, checked, removed}`.",
  tags,
  request: { body: { content: json(z.object({ cap: z.number().int().min(5).max(10) })) } },
  responses: {
    200: {
      description: "The saved cap and the trim job",
      content: json(envelope(z.object({ cap: z.number(), jobId: z.string() }))),
    },
    400: badInput,
  },
});

registry.registerPath({
  method: "post",
  path: "/places/visits/photos/auto-link/trim",
  summary: "Trim every visit's and entry's automatic links to the limit",
  description:
    "Idempotent job; user picks and refusals are untouched. Result: `{trimmed, checked, removed}`.",
  tags,
  responses: { 202: { description: "The job", content: json(jobId) } },
});
