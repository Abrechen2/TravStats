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
  maintenanceApplyRequestSchema,
  maintenanceConfirmRequestSchema,
  maintenanceConfirmResponseSchema,
  maintenanceNoticeSchema,
  maintenanceApplyResponseSchema,
  maintenanceIgnoreRequestSchema,
  maintenanceIgnoreResponseSchema,
  maintenanceProposalsRequestSchema,
  maintenanceProposalsResponseSchema,
  maintenanceUndoRequestSchema,
  maintenanceUndoResponseSchema,
  MAINTENANCE_SOURCES,
  pluginHelloSchema,
  pluginRequestSchema,
  pluginResponseSchema,
  pluginSuggestionSchema,
} from "../../plugins/contract";
import { pluginCreateSchema, pluginUpdateSchema, pluginViewSchema } from "../../plugins/registry";

registry.register("SuggestionPluginRequestV1", pluginRequestSchema);
registry.register("SuggestionPluginResponseV1", pluginResponseSchema);
registry.register("SuggestionPluginHelloV1", pluginHelloSchema);
// The optional maintenance capability: what TravStats sends and expects back.
registry.register("PluginMaintenanceProposalsRequestV1", maintenanceProposalsRequestSchema);
registry.register("PluginMaintenanceProposalsResponseV1", maintenanceProposalsResponseSchema);
registry.register("PluginMaintenanceNoticeV1", maintenanceNoticeSchema);
registry.register("PluginMaintenanceConfirmRequestV1", maintenanceConfirmRequestSchema);
registry.register("PluginMaintenanceConfirmResponseV1", maintenanceConfirmResponseSchema);
registry.register("PluginMaintenanceApplyRequestV1", maintenanceApplyRequestSchema);
registry.register("PluginMaintenanceApplyResponseV1", maintenanceApplyResponseSchema);
registry.register("PluginMaintenanceUndoRequestV1", maintenanceUndoRequestSchema);
registry.register("PluginMaintenanceUndoResponseV1", maintenanceUndoResponseSchema);
registry.register("PluginMaintenanceIgnoreRequestV1", maintenanceIgnoreRequestSchema);
registry.register("PluginMaintenanceIgnoreResponseV1", maintenanceIgnoreResponseSchema);

const tags = ["Settings"];
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });
const idParam = z.object({ id: z.string().uuid() });
const failed = {
  description:
    "The plugin did not answer usefully: `error` is timeout, unreachable, auth, rateLimited, " +
    "protocol, server or privateTarget; `code` is PLUGIN_FAILED.",
  content: errorContent,
};

const pluginListState = z.object({
  enabled: z.boolean(),
  announced: z.boolean().describe("The hello announces `list`"),
  listId: z.string().uuid().nullable(),
  listName: z.string().nullable(),
});

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

const maintenanceFailed = {
  description:
    "The plugin refused or failed: `error` is readOnly (its data source refuses writes), " +
    "changed (undo: the row was edited since), confirmationRequired (no valid ticket), notFound, notReady, auth (signature refused), " +
    "timeout, unreachable, rateLimited, protocol, server or privateTarget; `code` is PLUGIN_FAILED.",
  content: errorContent,
};
const noMaintenance = {
  description:
    "Switched off (SERVICE_DISABLED), or the plugin does not announce `maintenance` " +
    "(PLUGIN_NO_MAINTENANCE).",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/settings/suggestion-plugins/{id}/capabilities",
  summary: "A plugin's announced capabilities",
  description:
    "From its signed hello; `maintenance` is true when location maintenance is offered. `list` " +
    "is the plugin-fed list's state; it is created here on first use when the hello announces one.",
  tags,
  request: { params: idParam, query: z.object({ lang: z.enum(["de", "en"]).optional() }) },
  responses: {
    200: {
      description: "Capabilities",
      content: json(
        z.object({
          capabilities: z.array(z.string()),
          maintenance: z.boolean(),
          error: z.string().nullable(),
          list: pluginListState,
        })
      ),
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/suggestion-plugins/{id}/list",
  summary: "Keep this plugin's places as a list",
  description:
    "On creates the plugin-fed list (named as the hello's `list.defaultName`, else the " +
    "registration's name) and fills it with the places of accepted suggestions; off keeps the " +
    "list as a normal list that no longer grows.",
  tags,
  request: {
    params: idParam,
    query: z.object({ lang: z.enum(["de", "en"]).optional() }),
    body: { content: json(z.object({ enabled: z.boolean() })) },
  },
  responses: {
    200: { description: "The list state", content: json(pluginListState) },
    400: { description: "Invalid input", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/suggestion-plugins/{id}/maintenance",
  summary: "Rows of the plugin's data without a usable position, with proposals",
  description:
    "Owner of the plugin only. TravStats sends the account's venue-named TravTrack stops " +
    "(rounded to the plugin's precision, none at 1 km) for the plugin to match by name; the " +
    "plugin adds geocoder candidates. `stopsWithheld` says why no stops were sent.",
  tags,
  request: {
    params: idParam,
    query: z.object({
      locale: z.enum(["de", "en"]).optional(),
      q: z.string().max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(300).optional(),
    }),
  },
  responses: {
    200: {
      description: "Proposals",
      content: json(
        maintenanceProposalsResponseSchema.extend({
          stopsSent: z.number().int(),
          stopsWithheld: z.enum(["precision", "travtrackOff"]).nullable(),
        })
      ),
    },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/suggestion-plugins/{id}/maintenance/notices",
  summary: "The plugin's notices (uncertain cases) without the row list",
  description:
    "Owner of the plugin only. The plugin does not push: callers poll this paced (e.g. every 6 h " +
    "and after new stops). `notices` is most severe first; `noticeCount` and `totalRows` are the " +
    "full counts.",
  tags,
  request: { params: idParam, query: z.object({ locale: z.enum(["de", "en"]).optional() }) },
  responses: {
    200: {
      description: "Notices",
      content: json(
        z.object({
          notices: z.array(maintenanceNoticeSchema),
          noticeCount: z.number().int(),
          totalRows: z.number().int(),
          stopsSent: z.number().int(),
          stopsWithheld: z.enum(["precision", "travtrackOff"]).nullable(),
        })
      ),
    },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/maintenance/confirm",
  summary: "A single-use ticket for one archive write",
  description:
    "Called when the user confirms in the dialog; nothing is written. The ticket is bound to the " +
    "exact values (apply: rowId, lat, lon, street, postcode, town; undo: undoId), valid 10 minutes " +
    "and spent by its first use. Without it `apply`/`undo` fail with `confirmationRequired`.",
  tags,
  request: {
    params: idParam,
    body: {
      content: json(
        z.object({
          kind: z.enum(["apply", "undo"]),
          rowId: z.string().optional(),
          lat: z.number().optional(),
          lon: z.number().optional(),
          street: z.string().optional(),
          postcode: z.string().optional(),
          town: z.string().optional(),
          undoId: z.string().optional(),
        })
      ),
    },
  },
  responses: {
    200: { description: "Ticket", content: json(maintenanceConfirmResponseSchema) },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/maintenance/apply",
  summary: "Write one confirmed position into the plugin's data",
  description:
    "Needs the `token` of a `confirm` for exactly these values. The plugin writes the coordinates " +
    "and the street, postcode and town as the user edited them, and keeps the values before for undo.",
  tags,
  request: {
    params: idParam,
    body: {
      content: json(
        z.object({
          rowId: z.string(),
          lat: z.number(),
          lon: z.number(),
          street: z.string().optional(),
          postcode: z.string().optional(),
          town: z.string().optional(),
          source: z.enum(MAINTENANCE_SOURCES),
          token: z.string(),
        })
      ),
    },
  },
  responses: {
    200: { description: "Written", content: json(maintenanceApplyResponseSchema) },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/maintenance/undo",
  summary: "Undo an applied position",
  tags,
  request: {
    params: idParam,
    body: { content: json(z.object({ undoId: z.string(), token: z.string() })) },
  },
  responses: {
    200: { description: "Restored", content: json(maintenanceUndoResponseSchema) },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/suggestion-plugins/{id}/maintenance/ignore",
  summary: "Ignore a row in the maintenance list, or show it again",
  tags,
  request: {
    params: idParam,
    body: { content: json(z.object({ rowId: z.string(), ignored: z.boolean() })) },
  },
  responses: {
    200: { description: "Changed", content: json(maintenanceIgnoreResponseSchema) },
    400: maintenanceFailed,
    409: noMaintenance,
  },
});
