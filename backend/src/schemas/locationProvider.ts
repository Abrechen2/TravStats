import { z } from "./zod";
import { LOCATION_PROVIDER_KINDS } from "../services/locationProvider/kinds";

/**
 * The per-user location provider (TravTrack plan, task S2):
 * `PUT /settings/location-provider` and the shapes both location routes answer.
 */

export const locationProviderKindSchema = z.enum(LOCATION_PROVIDER_KINDS);

export const providerStatusSchema = z
  .enum(["ok", "notConfigured", "unavailable"])
  .describe(
    "ok = works; notConfigured = Dawarich chosen but the own connection is gone; " +
      "unavailable = TravTrack chosen but this server does not offer it"
  );

export const putLocationProviderSchema = z.object({ kind: locationProviderKindSchema }).strict();

export const locationProviderStateSchema = z.object({
  kind: locationProviderKindSchema,
  rev: z.number().int().describe("Raised on every switch"),
  status: providerStatusSchema,
});

export const locationProviderSettingsSchema = locationProviderStateSchema.extend({
  choices: z
    .object({
      none: z.literal(true),
      travtrack: z.boolean().describe("This server offers TravTrack to this account"),
      dawarich: z.boolean().describe("The account has its own Dawarich connection"),
    })
    .describe("What may be chosen right now"),
});
