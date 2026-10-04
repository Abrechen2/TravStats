import { z } from "./zod";
import { WEB_PREFS_LIMITS } from "../services/webPrefs/sections";

/**
 * Zod schemas for `/api/v1/settings/web-prefs` (forgejo#200) — the web app's
 * per-user display preferences, one entry per section.
 *
 * The envelope is checked here; a section's VALUE is checked by
 * `webPrefValueProblem` (services/webPrefs/sections.ts), which knows the
 * section's top-level kind and the depth/width/byte bounds. Zod's recursive
 * `z.lazy` JSON type has no depth bound, which is the one thing this route
 * must hold, so the value is `unknown` at this layer on purpose.
 */

const sectionWriteSchema = z.object({
  value: z.unknown(),
  /** When the value was changed on the device. Absent = the server's now. */
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

export const putWebPrefsSchema = z.object({
  sections: z
    .record(z.string().min(1).max(64), sectionWriteSchema)
    .refine((s) => Object.keys(s).length <= WEB_PREFS_LIMITS.maxSectionsPerRequest, {
      message: `at most ${WEB_PREFS_LIMITS.maxSectionsPerRequest} sections per request`,
    }),
});

export type PutWebPrefsInput = z.infer<typeof putWebPrefsSchema>;

const storedSectionSchema = z.object({
  value: z.unknown().describe("The section's value, as the web app wrote it."),
  updatedAt: z.string().describe("When the value was changed, on the device that changed it."),
});

export const webPrefsResponseSchema = z.object({
  sections: z
    .record(z.string(), storedSectionSchema)
    .describe("Every stored section. A section never written is absent."),
  updatedAt: z
    .string()
    .nullable()
    .describe("The newest section's `updatedAt`; null when nothing is stored."),
  stale: z
    .array(z.string())
    .optional()
    .describe(
      "PUT only: sections whose write was older than the stored value and was " +
        "therefore not applied. The stored value is in `sections`."
    ),
  dropped: z
    .array(z.string())
    .optional()
    .describe("PUT only: section names this server does not know, ignored."),
});
