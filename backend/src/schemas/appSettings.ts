import { z } from "zod";

/**
 * Zod schema for the app-settings backup/sync routes
 * (`/api/v1/app-settings`).
 *
 * The mobile app stores an opaque JSON "preferences" blob (units, date /
 * time formats, …) so a re-paired or new device can auto-restore the
 * user's app settings. The server treats `prefs` as an opaque object — it
 * never inspects the contents — but it DOES enforce that the top level is a
 * JSON object (not an array, string, number, null) and stays under a sane
 * size cap so a single user can't park megabytes in the row.
 *
 * PAT / device identity are NEVER part of this blob.
 */

/**
 * Maximum serialized size of the prefs blob, in bytes. App preferences are
 * a handful of flags and format strings — 32 KB is generous headroom while
 * still rejecting accidental or malicious bloat.
 */
export const APP_PREFS_MAX_BYTES = 32 * 1024;

/**
 * A recursive JSON value. Used so the prefs object can nest arbitrarily
 * while still being validated as well-formed JSON (no functions, undefined,
 * etc. — those can't survive a JSON round-trip anyway).
 */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ])
);

/**
 * The top level MUST be a plain JSON object — arrays and primitives are
 * rejected so the stored shape is predictable for the client.
 */
const prefsObjectSchema = z
  .record(jsonValueSchema)
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= APP_PREFS_MAX_BYTES,
    { message: `prefs exceeds ${APP_PREFS_MAX_BYTES} bytes` }
  );

/**
 * PUT body. `updatedAt` is optional: when the client supplies it, the
 * server honours it (last-write-wins from the device's clock); otherwise
 * the server stamps `now()`.
 */
export const putAppSettingsSchema = z.object({
  prefs: prefsObjectSchema,
  updatedAt: z.string().datetime().optional(),
});

export type PutAppSettingsInput = z.infer<typeof putAppSettingsSchema>;
