/**
 * The location provider's vocabulary, apart from `provider.ts` so the Zod
 * schemas can name it without loading the database client.
 */
export const LOCATION_PROVIDER_KINDS = ["none", "travtrack", "dawarich"] as const;
export type LocationProviderKind = (typeof LOCATION_PROVIDER_KINDS)[number];
export type ProviderStatus = "ok" | "notConfigured" | "unavailable";
