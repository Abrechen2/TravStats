/**
 * The error codes of the per-user location provider (TravTrack plan,
 * `services/locationProvider/provider.ts`). Part of `ApiErrorCode`
 * (`errorHandler.ts`), kept here so that list stays readable. TravTrack's own
 * codes ride along, so `errorHandler.ts` (at its size limit) needs no new line.
 */
import type { LocationEvidenceApiErrorCode } from "./locationEvidenceErrorCodes";
import type { TravTrackApiErrorCode } from "./travTrackErrorCodes";

export type LocationProviderApiErrorCode =
  | "DAWARICH_NOT_CONFIGURED" // Dawarich chosen without the user's OWN connection (409)
  | "TRAVTRACK_UNAVAILABLE" // TravTrack chosen while this instance does not offer it (409)
  | TravTrackApiErrorCode
  | LocationEvidenceApiErrorCode;
