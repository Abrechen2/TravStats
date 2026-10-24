import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  locationProviderSettingsSchema,
  putLocationProviderSchema,
} from "../../../schemas/locationProvider";

/**
 * The per-user location provider (TravTrack plan 2026-10-24):
 * `routes/settings/locationProvider.ts`. Bare.
 */

registry.registerPath({
  method: "get",
  path: "/settings/location-provider",
  summary: "The chosen location source",
  description:
    "Where the Companion's new recordings go and where automatic features read positions " +
    "from. A provider that stopped working stays chosen and says so in `status`.",
  tags: ["Settings"],
  responses: {
    200: {
      description: "The choice, whether it works, and what may be chosen",
      content: { "application/json": { schema: locationProviderSettingsSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/settings/location-provider",
  summary: "Choose the location source",
  description:
    "Changes only what is recorded and read from now on: nothing is moved, copied or " +
    "deleted. `rev` rises when the choice changes. Dawarich needs the account's own " +
    "connection — a shared admin connection does not count.",
  tags: ["Settings"],
  request: { body: { content: { "application/json": { schema: putLocationProviderSchema } } } },
  responses: {
    200: {
      description: "What is chosen now",
      content: { "application/json": { schema: locationProviderSettingsSchema } },
    },
    400: { description: "VALIDATION_FAILED: an unknown kind", content: errorContent },
    403: { description: "A read-only token, or the shared demo account", content: errorContent },
    409: {
      description:
        "DAWARICH_NOT_CONFIGURED (no own Dawarich connection) or TRAVTRACK_UNAVAILABLE " +
        "(this server does not offer TravTrack); the stored choice is unchanged",
      content: errorContent,
    },
  },
});
