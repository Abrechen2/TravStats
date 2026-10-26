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

/** The same filter for an account whose source is TravTrack. */
export const TRAVTRACK_PROVIDER_WHERE = { locationProvider: "travtrack" } as const;

/**
 * Which accounts the scheduled stay scan picks (TravTrack plan E3): provider
 * `dawarich`, and — only while the instance's TravTrack is on — provider
 * `travtrack`. The instance switch is not a column of `user_settings`, so the
 * scheduler asks it once per sweep and picks the matching filter; with
 * TravTrack off the filter is exactly the Dawarich one it always was.
 */
export const STAY_SCAN_PROVIDER_WHERE: {
  travTrackOff: typeof DAWARICH_PROVIDER_WHERE;
  travTrackOn: { locationProvider: { in: string[] } };
} = {
  travTrackOff: DAWARICH_PROVIDER_WHERE,
  travTrackOn: { locationProvider: { in: ["dawarich", "travtrack"] } },
};
