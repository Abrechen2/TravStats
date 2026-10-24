import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  locationProviderSettingsSchema,
  locationProviderStateSchema,
  putLocationProviderSchema,
} from "../../../schemas/locationProvider";

/**
 * The per-user location provider (TravTrack plan 2026-10-24):
 * `routes/settings/locationProvider.ts` and `routes/locationCapabilities.ts`. Bare.
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

const capabilities = z.object({
  version: z.literal(1),
  provider: locationProviderStateSchema,
  capture: z.object({
    flight: z
      .boolean()
      .describe(
        "Record flights with the app: provider none or a working travtrack, if switched on"
      ),
    trip: z
      .boolean()
      .describe("Record trips with the app: provider none or a working travtrack, if switched on"),
    everyday: z.boolean().describe("Everyday location history through TravTrack"),
    modes: z
      .array(z.enum(["off", "trips", "everyday"]))
      .describe("Recording modes to offer; empty without TravTrack"),
    sink: z
      .enum(["entries", "travtrack"])
      .nullable()
      .describe(
        "Where recordings go: entries (/flights/:id/track, /trips/:id/recording), travtrack " +
          "(/travtrack/points), or null when nothing is recorded (provider dawarich)"
      ),
  }),
  travTrack: z.object({
    offered: z.boolean().describe("This server offers TravTrack to this account"),
    enabled: z.boolean().describe("TravTrack is the chosen, working provider (= capture)"),
    capture: z.boolean().describe("Start recording into TravTrack"),
    upload: z
      .boolean()
      .describe(
        "This server takes POST /travtrack/points, whatever the provider: points queued for " +
          "TravTrack keep leaving the phone after a switch"
      ),
  }),
});

registry.registerPath({
  method: "get",
  path: "/location/capabilities",
  summary: "What the Companion should record",
  description:
    "Steers what the phone starts recording. The recording routes never consult it: a " +
    "recording queued before a switch keeps its target and is accepted. Read-only tokens may " +
    "call it; an older server answers 404, which a client treats as today's behaviour.",
  tags: ["Settings"],
  responses: {
    200: {
      description: "The provider and what to capture",
      content: { "application/json": { schema: capabilities } },
    },
    401: { description: "No session", content: errorContent },
  },
});
