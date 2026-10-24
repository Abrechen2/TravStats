/**
 * The location provider's vocabulary, apart from `provider.ts` so the Zod
 * schemas can name it without loading the database client.
 */
export const LOCATION_PROVIDER_KINDS = ["none", "travtrack", "dawarich"] as const;
export type LocationProviderKind = (typeof LOCATION_PROVIDER_KINDS)[number];
export type ProviderStatus = "ok" | "notConfigured" | "unavailable";

/**
 * The `user_settings` filter an unattended Dawarich job adds to the query that
 * picks its accounts (TravTrack plan S3): the provider is `dawarich`. The other
 * half of `providerIs(…, "dawarich")` — the own connection still works — is
 * each job's existing user-tier connection check, so the two together select
 * exactly the accounts `providerIs` would.
 */
export const DAWARICH_PROVIDER_WHERE = { locationProvider: "dawarich" } as const;
