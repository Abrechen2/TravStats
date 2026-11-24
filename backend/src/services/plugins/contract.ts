/**
 * The suggestion plugin contract, version 1 (spec 2026-11-23-plugins-and-
 * calendar.md, Part B). The ONE definition: the client validates answers with
 * it, the OpenAPI document registers it as components, and the plugin
 * template's `contract/v1.schema.json` is exported from those components
 * (`scripts/export-plugin-contract.ts`), with a test that they are equal.
 *
 * Additive fields inside a major are allowed both ways and ignored when
 * unknown: the response objects are not strict. An unknown major is a
 * `protocol` failure.
 */
import { z } from "../../schemas/zod";

export const PLUGIN_CONTRACT_VERSION = 1;
export const MAX_SUGGESTIONS = 5;

const text = (max: number) => z.string().max(max);

export const pluginStopSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    timeZone: z.string().max(64),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** How far the coordinates were rounded before they left: 1, 100 or 1000. */
    precisionMeters: z.number().int().min(1),
    nearestPlace: z.object({ name: text(200), distanceMeters: z.number().int().min(0) }).optional(),
    venue: z.object({ name: text(200), category: text(64).optional() }).optional(),
    address: z
      .object({
        street: text(200).optional(),
        postcode: text(32).optional(),
        town: text(200).optional(),
        country: text(64).optional(),
      })
      .optional(),
  })
  .openapi("SuggestionPluginStopV1");

export const pluginRequestSchema = z
  .object({
    version: z.literal(PLUGIN_CONTRACT_VERSION),
    /** `test`: the settings page's test button, with a fixed synthetic stop. */
    kind: z.enum(["stop", "test"]),
    requestId: z.string().uuid(),
    stop: pluginStopSchema,
    locale: z.enum(["de", "en"]),
  })
  .openapi("SuggestionPluginRequestV1");
export type PluginRequest = z.infer<typeof pluginRequestSchema>;

export const pluginSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: text(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    purpose: z.enum(["private", "business"]).optional(),
    note: text(500).optional(),
    externalRef: text(200).optional(),
    /** Rendered as a plain link, never fetched by TravStats. */
    url: z
      .string()
      .max(2000)
      .url()
      .refine((u) => u.startsWith("https://"), { message: "https only" })
      .optional(),
    confidence: z.number().min(0).max(1),
  })
  .openapi("SuggestionPluginSuggestionV1");
export type PluginSuggestion = z.infer<typeof pluginSuggestionSchema>;

export const pluginResponseSchema = z
  .object({
    version: z.number().int().min(1),
    suggestions: z.array(pluginSuggestionSchema).max(MAX_SUGGESTIONS),
  })
  .openapi("SuggestionPluginResponseV1");

/** The optional signed `GET <url>`: who the plugin is and which kinds it answers. */
export const pluginHelloSchema = z
  .object({
    name: text(100),
    version: z.number().int().min(1),
    kinds: z.array(text(32)).max(10),
  })
  .openapi("SuggestionPluginHelloV1");
