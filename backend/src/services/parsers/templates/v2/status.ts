/**
 * What `/template-status` reports about v2 templates.
 *
 * Every template the index or the cache named appears here exactly once,
 * either `active` or `rejected` with the reason it is not — a template that
 * silently fails to load is the failure the parser-system design exists to
 * end. The Zod schema doubles as the OpenAPI contract of the route.
 */
import { z } from "zod";

export const V2_REJECTION_REASONS = [
  "fetch_failed",
  "invalid",
  "tests_failed",
  "needs_newer_app",
] as const;
export type V2RejectionReason = (typeof V2_REJECTION_REASONS)[number];

export const v2TemplateStatusEntrySchema = z.object({
  id: z.string().describe("Template id, `<domain>:<slug>`, or `index[N]` for an unreadable entry"),
  domain: z.string(),
  version: z
    .string()
    .nullable()
    .describe("The version that is active, or the one that was rejected"),
  state: z.enum(["active", "rejected"]),
  source: z
    .enum(["remote", "cached", "snapshot"])
    .describe(
      "Fetched in the last sync, read from this instance's disk cache, or bundled with this release"
    ),
  reason: z.enum(V2_REJECTION_REASONS).optional().describe("Why a template is not active"),
  detail: z
    .string()
    .optional()
    .describe(
      "The failing check in words. On an active template: a newer version was offered and refused"
    ),
});
export type V2TemplateStatusEntry = z.infer<typeof v2TemplateStatusEntrySchema>;

export const v2StatusSchema = z.object({
  index: z
    .enum(["unknown", "available", "unavailable"])
    .describe(
      "Whether the v2 index.json was read in the last sync. `unknown` = no sync yet; `unavailable` = the v1 airline path alone is in use"
    ),
  templates: z.array(v2TemplateStatusEntrySchema),
});
export type V2Status = z.infer<typeof v2StatusSchema>;
