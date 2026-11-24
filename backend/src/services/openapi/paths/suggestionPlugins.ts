/**
 * Suggestion plugins (spec 2026-11-23-plugins-and-calendar.md, Part B): the
 * settings endpoints, and the plugin contract itself (v1) as components —
 * `SuggestionPluginRequestV1`, `SuggestionPluginResponseV1`, … — from which the
 * template's `contract/v1.schema.json` is exported, so the two cannot drift.
 */
import { z } from "zod";
import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  pluginHelloSchema,
  pluginRequestSchema,
  pluginResponseSchema,
  pluginSuggestionSchema,
} from "../../plugins/contract";
import { pluginCreateSchema, pluginUpdateSchema, pluginViewSchema } from "../../plugins/registry";

registry.register("SuggestionPluginRequestV1", pluginRequestSchema);
registry.register("SuggestionPluginResponseV1", pluginResponseSchema);
registry.register("SuggestionPluginHelloV1", pluginHelloSchema);

const tags = ["Settings"];
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const idParam = z.object({ id: z.string().uuid() });
const failed = {
  description:
    "The plugin did not answer usefully: `error` is timeout, unreachable, auth, rateLimited, " +
    "protocol, server or privateTarget; `code` is PLUGIN_FAILED.",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/settings/suggestion-plugins",
  summary: "List the suggestion plugins",
  description: "Never the secret. `blocked` says whether plugins are switched off on this server.",
  tags,
  responses: {
    200: {
      description: "Plugins",
      content: json(
        z.object({
          plugins: z.array(pluginViewSchema),
          blocked: z.enum(["internet_off", "service_off"]).nullable(),
        })
      ),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins",
  summary: "Add a suggestion plugin",
  description:
    "TravStats generates the 32-byte secret and returns it ONCE. At most five plugins " +
    "(PLUGIN_LIMIT). An ordinary account's URL must be a public https address (forgejo#411).",
  tags,
  request: { body: { content: json(pluginCreateSchema) } },
  responses: {
    201: {
      description: "Added",
      content: json(z.object({ plugin: pluginViewSchema, secret: z.string() })),
    },
    400: { description: "Invalid", content: errorContent },
    409: { description: "Limit reached", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/settings/suggestion-plugins/{id}",
  summary: "Change a suggestion plugin",
  tags,
  request: { params: idParam, body: { content: json(pluginUpdateSchema) } },
  responses: {
    200: { description: "Changed", content: json(pluginViewSchema) },
    400: { description: "Invalid", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/suggestion-plugins/{id}",
  summary: "Remove a suggestion plugin",
  description: "Its suggestions on open findings, and the findings it alone made, go with it.",
  tags,
  request: { params: idParam },
  responses: {
    204: { description: "Removed" },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/rotate",
  summary: "Replace a plugin's secret",
  description: "The new secret is returned once; the old one stops working at once.",
  tags,
  request: { params: idParam },
  responses: { 200: { description: "Rotated", content: json(z.object({ secret: z.string() })) } },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/test",
  summary: "Ask a plugin about a synthetic stop",
  description:
    'A signed `kind: "test"` request with a fixed public square and no account data, plus the ' +
    "optional signed hello (`GET <url>`).",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "Answered",
      content: json(
        z.object({
          ok: z.literal(true),
          outcome: z.enum(["ok", "empty"]),
          latencyMs: z.number().int(),
          version: z.number().int().nullable(),
          first: pluginSuggestionSchema.nullable(),
          hello: pluginHelloSchema.nullable(),
        })
      ),
    },
    400: failed,
    409: { description: "Plugins are switched off", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/backfill",
  summary: "Ask a plugin about past days",
  description:
    "A job over at most 90 days, under the plugin's hourly and daily limits; answered stops are " +
    "skipped and nothing is accepted. Refused unless the plugin allows it (PLUGIN_BACKFILL_REFUSED).",
  tags,
  request: {
    params: idParam,
    body: {
      content: json(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
      ),
    },
  },
  responses: {
    202: { description: "Started", content: json(z.object({ jobId: z.string() })) },
    400: { description: "Refused", content: errorContent },
    409: { description: "Running or switched off", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/reask",
  summary: "Ask the plugins about one finding again",
  description: "Forgets their recorded answers for that stop; the next scan asks them.",
  tags,
  request: { body: { content: json(z.object({ stayId: z.string().uuid() })) } },
  responses: {
    200: { description: "Owed again", content: json(z.object({ pending: z.number().int() })) },
    404: { description: "Not found", content: errorContent },
  },
});
