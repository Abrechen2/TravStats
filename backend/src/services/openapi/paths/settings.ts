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
import { errorContent, timeRefused } from "./shared";
import { profileZoneBodySchema, profileZoneViewSchema } from "../../settings/profileZoneSettings";
import {
  homeAirportsResponseSchema,
  homePeriodsBodySchema,
  nearbyHomeAirportsQuerySchema,
  nearbyHomeAirportsResponseSchema,
} from "../../../schemas/home";
import { putWebPrefsSchema, webPrefsResponseSchema } from "../../../schemas/webPrefs";

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
  responses: { 422: timeRefused, 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "put",
  path: "/settings/profile-zone",
  summary: "Set the zone that answers 'today' for this account",
  description:
    "The profile zone (ADR 0002 D4/Q1): the zone every status, countdown and " +
    "'past or planned' of this account is answered in. Written into the same " +
    "`display.timezone` that `PUT /settings` writes, without replacing the rest of " +
    "`display`. `GET /settings` reports it as `profileZone`; `hasProfileZone: false` " +
    "is the account the web asks at its next login. `followsDevice` is the " +
    "Companion's opt-in to keep the zone in step with the phone.",
  tags: settingsTag,
  request: { body: { content: { "application/json": { schema: profileZoneBodySchema } } } },
  responses: {
    200: {
      description: "Saved",
      content: {
        "application/json": { schema: z.object({ profileZone: profileZoneViewSchema }) },
      },
    },
    422: timeRefused,
  },
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
  responses: { 422: timeRefused, 200: { description: "Saved" }, 400: badInput },
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

const homeAirportsOk = {
  description:
    "Home by date, in both shapes: `periods` (residence + one to three home airports, one " +
    "primary) and `history`, the old one-airport list derived from the periods' primaries.",
  content: { "application/json": { schema: homeAirportsResponseSchema } },
};
const homeRefused = {
  description:
    "Refused with a stable code: `HOME_PERIODS_INVALID` (shape, more than three airports, " +
    "not exactly one primary, overlapping periods) or `HOME_AIRPORT_UNKNOWN` with `codes`.",
  content: errorContent,
};
const legacyHomeNote =
  "The old one-airport write, kept for clients that predate residence + home airports. " +
  "Converted onto the periods: the index is the period's position.";

registry.registerPath({
  method: "get",
  path: "/settings/home-airports",
  summary: "Get the user's home — residence and home airports by date",
  description:
    "Airport questions (home loops, layovers, the passport) use membership in a period's " +
    "airport set; distance questions measure from its residence; prefills use its primary. " +
    "An account holding only the old shape is migrated on read: one period per entry, the " +
    "residence at the airport, `residenceConfirmed: false`.",
  tags: settingsTag,
  responses: { 200: homeAirportsOk },
});

registry.registerPath({
  method: "put",
  path: "/settings/home-airports/periods",
  summary: "Replace the user's home periods",
  tags: settingsTag,
  request: {
    body: { content: { "application/json": { schema: homePeriodsBodySchema } }, required: true },
  },
  responses: { 200: homeAirportsOk, 400: homeRefused },
});

registry.registerPath({
  method: "get",
  path: "/settings/home-airports/nearby",
  summary: "Airports near a residence, nearest first",
  description:
    "An offer for the settings page, not the list of allowed airports: open airports with an " +
    "IATA code within 150 km, at most six. Airports without scheduled service (air bases, " +
    "business fields) are left out unless the user has a non-cancelled flight from or to " +
    "them. Any airport can be added through the airport search.",
  tags: settingsTag,
  request: { query: nearbyHomeAirportsQuerySchema },
  responses: {
    200: {
      description: "Nearby airports",
      content: { "application/json": { schema: nearbyHomeAirportsResponseSchema } },
    },
    400: badInput,
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/home-airports",
  summary: "Record a move (old one-airport shape)",
  description:
    legacyHomeNote +
    " Closes the running period and opens one with this airport; its residence is the " +
    "airport, unconfirmed, until the user confirms it.",
  tags: settingsTag,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ iata: z.string(), fromDate: z.string().optional() }),
        },
      },
      required: true,
    },
  },
  responses: { 200: homeAirportsOk, 400: badInput },
});

registry.registerPath({
  method: "patch",
  path: "/settings/home-airports/{index}",
  summary: "Correct one home period (old one-airport shape)",
  description: legacyHomeNote + " A new `iata` becomes the primary; a confirmed residence is kept.",
  tags: settingsTag,
  request: {
    params: z.object({ index: z.coerce.number().int().min(0) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            iata: z.string().optional(),
            fromDate: z.string().optional(),
            toDate: z.string().nullable().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: { 200: homeAirportsOk, 400: badInput, 404: notFound },
});

registry.registerPath({
  method: "delete",
  path: "/settings/home-airports/{index}",
  summary: "Remove one home period",
  tags: settingsTag,
  request: { params: z.object({ index: z.coerce.number().int().min(0) }) },
  responses: { 200: homeAirportsOk, 404: notFound },
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

for (const provider of ["airlabs", "aviationstack", "aerodatabox", "aeroapi", "opensky"] as const) {
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
  path: "/settings/dawarich",
  summary: "Get the Dawarich connection",
  description: "Returns the base URL and whether a key is stored, never the key.",
  tags: settingsTag,
  responses: { 200: { description: "Dawarich settings" } },
});

registry.registerPath({
  method: "put",
  path: "/settings/dawarich",
  summary: "Set the Dawarich connection",
  description:
    "A self-hosted Dawarich normally lives on the same LAN, so a private address is " +
    "expressly allowed — blocking one would break the ordinary case. An instance " +
    "that exposes this to untrusted users must restrict it at the deployment layer.",
  tags: settingsTag,
  responses: { 200: { description: "Saved" }, 400: badInput },
});

registry.registerPath({
  method: "post",
  path: "/settings/dawarich/test",
  summary: "Try the Dawarich connection",
  description:
    "Failures come back with a fixed kind — notConfigured, unreachable, auth, " +
    "notFound, protocol or invalidUrl — so a client can say something useful. " +
    "`invalidUrl` means the address was rejected before anything was contacted; " +
    "`protocol` means Dawarich answered but not in a shape we understood. The two " +
    "are kept apart so a typo does not send someone debugging their server. " +
    "Pull-only: this and every other Dawarich endpoint only ever reads from it.",
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

registry.registerPath({
  method: "get",
  path: "/settings/web-prefs",
  summary: "Get the web app's display preferences",
  description:
    "The browser app's per-user display choices — colours, map appearance, the " +
    "dashboard domain filter, table and statistics view choices — so they follow " +
    "the user to every browser (forgejo#200). Stored per section; a section never " +
    "written is absent. Separate from `/app-settings`, which is the Companion's blob.",
  tags: settingsTag,
  responses: {
    200: {
      description: "Stored sections",
      content: { "application/json": { schema: webPrefsResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/web-prefs",
  summary: "Save some sections of the web app's display preferences",
  description:
    "Merges per section: sections not named in the body are kept. Within a section " +
    "the newer `updatedAt` wins (capped at the server's now); an older write is not " +
    "applied and is listed in `stale`. Unknown section names are ignored and listed " +
    "in `dropped`. Read-scoped tokens and the shared demo account are refused.",
  tags: settingsTag,
  request: { body: { content: { "application/json": { schema: putWebPrefsSchema } } } },
  responses: {
    200: {
      description: "Saved; the full stored state",
      content: { "application/json": { schema: webPrefsResponseSchema } },
    },
    400: { description: "Invalid section value (WEB_PREFS_INVALID)", content: errorContent },
    403: { description: "Read-scoped token or demo account", content: errorContent },
    413: {
      description: "A section or the account's total is over its byte cap (WEB_PREFS_TOO_LARGE)",
      content: errorContent,
    },
  },
});
