/**
 * Zod schemas for the Dawarich settings boundary: connection writes and
 * connection tests. Mirrors `schemas/immich.ts`'s connection/test pair —
 * Dawarich has no album-link or asset-proxy surface, so nothing else here
 * has an Immich counterpart.
 */
import { z } from "zod";

/**
 * The settings card always SENDS `baseUrl` (it never omits the field), so an
 * empty string is the only way the UI can express "clear the stored URL".
 * Coerce it to an explicit `null` — the schema's own clear signal — instead
 * of letting `.min(1)` reject it with a 400 that makes clearing impossible.
 */
const clearableBaseUrlField = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().min(1).max(500).nullable().optional(),
);

/** Partial update — an omitted field is untouched, an explicit null clears it. */
export const dawarichConnectionSchema = z
  .object({
    baseUrl: clearableBaseUrlField,
    apiKey: z.string().min(1).max(500).nullable().optional(),
  })
  .strict();

/**
 * A connection field that is optional AND treats an empty string as absent.
 * The settings card always SENDS `baseUrl`/`apiKey`; when the user has no
 * own connection it sends `""`. Coercing `"" -> undefined` lets that mean
 * "test whatever is currently resolved for me" (user tier -> admin global
 * -> ENV) instead of tripping `.min(1)` with a 400 before the route's
 * fallback runs.
 */
const optionalConnectionField = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).max(500).optional(),
);

/** Test an ad-hoc pair before saving, or fall back to the stored connection. */
export const dawarichTestSchema = z
  .object({
    baseUrl: optionalConnectionField,
    apiKey: optionalConnectionField,
  })
  .strict();

export type DawarichConnectionInput = z.infer<typeof dawarichConnectionSchema>;
export type DawarichTestInput = z.infer<typeof dawarichTestSchema>;
