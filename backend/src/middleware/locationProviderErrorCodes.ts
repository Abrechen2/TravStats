/**
 * The error codes of the per-user location provider (TravTrack plan,
 * `services/locationProvider/provider.ts`). Part of `ApiErrorCode`
 * (`errorHandler.ts`), kept here so that list stays readable.
 */
export type LocationProviderApiErrorCode =
  | "DAWARICH_NOT_CONFIGURED" // Dawarich chosen without the user's OWN connection (409)
  | "TRAVTRACK_UNAVAILABLE"; // TravTrack chosen while this instance does not offer it (409)
