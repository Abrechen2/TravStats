/**
 * Per-user settings.
 *
 * Everything here belongs to the calling user and to nobody else — these are
 * not instance settings, which live behind the admin surface and are
 * deliberately outside this spec.
 *
 * ONE RULE RUNS THROUGH THE WHOLE FAMILY AND IS WORTH READING ONCE: a secret
 * that goes in never comes back out. The API-key endpoints accept keys and
 * return only whether each provider is configured, never the value. A response
 * that echoed a key would put it in every log, cache and browser history the
 * request passed through.
 *
 * The `test/*` endpoints exist for the same reason: the only honest way to
 * answer "is this key any good" is to spend one call on it, so the client asks
 * the server to try rather than guessing from the key's shape.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const settingsTag = ["Settings"];
const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };

const providerStatus = registry.register(
  "ApiKeyStatus",
  z
    .object({
      configured: z
        .boolean()
        .describe("Whether a key is stored. The key itself is never returned."),
      source: z
        .string()
        .describe(
          'Where the key resolved from: "user", "admin" for an instance-wide key, ' +
            'or "env". The resolver takes them in that order.'
        ),
    })
    .openapi("ApiKeyStatus")
);

const homeAirport = registry.register(
  "HomeAirport",
  z
    .object({
      iata: z.string().length(3),
      label: z.string().nullable(),
    })
    .describe(
      "An airport the user departs from often. Several are allowed and the order " +
        "is the user's: the first is the default a new flight is offered."
    )
    .openapi("HomeAirport")
);

registry.registerPath({
  method: "get",
  path: "/settings",
  summary: "Get the user's settings",
  tags: settingsTag,
  responses: { 200: { description: "Settings" } },
});

registry.registerPath({
  method: "put",
  path: "/settings",
  summary: "Replace the user's settings",
  description:
    "Includes which domains are switched on. Switching one off hides it " +
    "everywhere and deletes nothing — the data is waiting if it is switched " +
    "back on.",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/settings/profile",
  summary: "Get the user's profile",
  tags: settingsTag,
  responses: { 200: { description: "Profile" } },
});

registry.registerPath({
  method: "put",
  path: "/settings/profile",
  summary: "Update the user's profile",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/settings/profile-picture",
  summary: "Upload a profile picture",
  description: "multipart/form-data, one image.",
  tags: settingsTag,
  responses: { 200: { description: "Uploaded" }, 400: badInput },
});

registry.registerPath({
  method: "delete",
  path: "/settings/profile-picture",
  summary: "Remove the profile picture",
  tags: settingsTag,
  responses: { 204: { description: "Removed" } },
});

registry.registerPath({
  method: "get",
  path: "/settings/profile-picture/{filename}",
  summary: "Fetch a profile picture",
  description:
    "Sets its own `Cache-Control: private`, overriding the API-wide `no-store`. " +
    "Private and never public: a shared cache must not hold one user's face.",
  tags: settingsTag,
  request: { params: z.object({ filename: z.string() }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/home-airports",
  summary: "List the user's home airports",
  tags: settingsTag,
  responses: {
    200: {
      description: "Home airports, in the user's order",
      content: { "application/json": { schema: z.array(homeAirport) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/home-airports",
  summary: "Add a home airport",
  tags: settingsTag,
  request: {
    body: { content: { "application/json": { schema: homeAirport } }, required: true },
  },
  responses: { 201: { description: "Added" }, 400: badInput },
});

registry.registerPath({
  method: "patch",
  path: "/settings/home-airports/{index}",
  summary: "Change one home airport",
  description: "Addressed by POSITION in the list, not by code — the order is meaningful.",
  tags: settingsTag,
  request: {
    params: z.object({ index: z.coerce.number().int().min(0) }),
    body: { content: { "application/json": { schema: homeAirport } }, required: true },
  },
  responses: { 200: { description: "Updated" }, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/settings/home-airports/{index}",
  summary: "Remove one home airport",
  tags: settingsTag,
  request: { params: z.object({ index: z.coerce.number().int().min(0) }) },
  responses: { 204: { description: "Removed" }, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/settings/api-keys",
  summary: "Which flight-data providers are configured",
  description:
    "Status only. No key is ever returned, by any endpoint — see the note at the " +
    "top of this file.",
  tags: settingsTag,
  responses: {
    200: {
      description: "Provider status",
      content: {
        "application/json": { schema: z.record(z.string(), providerStatus) },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/api-keys",
  summary: "Store flight-data provider keys",
  description:
    "Keys are encrypted at rest. Sending an empty value for a provider clears " +
    "the stored key rather than storing an empty one.",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/settings/api-keys/quota",
  summary: "What is left of each provider's allowance",
  description:
    "For providers that publish one. A provider with no quota concept is absent " +
    "rather than reported as unlimited.",
  tags: settingsTag,
  responses: { 200: { description: "Quota per provider" } },
});

for (const provider of ["airlabs", "aviationstack", "aerodatabox", "opensky"] as const) {
  registry.registerPath({
    method: "post",
    path: `/settings/api-keys/test/${provider}`,
    summary: `Try the ${provider} key`,
    description:
      "Spends one real call against the provider. That is the point: the shape of " +
      "a key says nothing about whether it works.",
    tags: settingsTag,
    responses: {
      200: {
        description: "Result",
        content: {
          "application/json": {
            schema: z.object({ ok: z.boolean(), message: z.string().optional() }),
          },
        },
      },
      400: badInput,
    },
  });
}

registry.registerPath({
  method: "get",
  path: "/settings/immich",
  summary: "Get the Immich connection",
  description: "Returns the base URL and whether a key is stored, never the key.",
  tags: settingsTag,
  responses: { 200: { description: "Immich settings" } },
});

registry.registerPath({
  method: "put",
  path: "/settings/immich",
  summary: "Set the Immich connection",
  description:
    "A self-hosted Immich normally lives on the same LAN, so a private address is " +
    "expressly allowed — blocking one would break the ordinary case. An instance " +
    "that exposes this to untrusted users must restrict it at the deployment layer.",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/settings/immich/test",
  summary: "Try the Immich connection",
  description:
    "Failures come back with a fixed kind — notConfigured, unreachable, auth, " +
    "notFound, protocol or invalidUrl — so a client can say something useful. " +
    "`invalidUrl` means the address was rejected before anything was contacted; " +
    "`protocol` means Immich answered but not in a shape we understood. The two " +
    "are kept apart so a typo does not send someone debugging their server.",
  tags: settingsTag,
  responses: {
    200: { description: "Reachable" },
    400: { description: "Failed, with a kind", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/settings/notifications",
  summary: "Get notification settings",
  tags: settingsTag,
  responses: { 200: { description: "Notification settings" } },
});

registry.registerPath({
  method: "put",
  path: "/settings/notifications",
  summary: "Update notification settings",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/settings/parser",
  summary: "Get parser settings",
  description: "Which parser is preferred for text and for images, and the model behind it.",
  tags: settingsTag,
  responses: { 200: { description: "Parser settings" } },
});

registry.registerPath({
  method: "put",
  path: "/settings/parser",
  summary: "Update parser settings",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "get",
  path: "/app-settings",
  summary: "Settings that describe the instance itself",
  description:
    "The handful a normal client needs: the instance name, whether registration " +
    "is open, and which optional features are switched on. Everything else about " +
    "the instance is admin surface and outside this spec.",
  tags: settingsTag,
  responses: { 200: { description: "App settings" } },
});

registry.registerPath({
  method: "put",
  path: "/app-settings",
  summary: "Update the instance settings a normal client may change",
  tags: settingsTag,
  responses: {
    200: { description: "Saved" },
    400: badInput,
    403: { description: "Not permitted", content: errorContent },
  },
});
