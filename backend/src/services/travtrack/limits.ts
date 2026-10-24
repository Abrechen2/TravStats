/**
 * TravTrack's wire vocabulary and limits, apart from the services so the Zod
 * schemas and the OpenAPI paths can name them without loading the database
 * client (as `services/locationProvider/kinds.ts` does for the provider).
 */

export const GAP_REASONS = ["zonesUnknown", "recorderSilent", "permission"] as const;
export type GapReason = (typeof GAP_REASONS)[number];

/** Gaps per upload. */
export const MAX_GAPS = 100;
