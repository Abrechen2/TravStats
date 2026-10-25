/**
 * The error codes of TravTrack, the own location history (TravTrack plan,
 * phase 2). Part of `ApiErrorCode` through `LocationProviderApiErrorCode`, kept
 * here so that list stays readable. The `LOCATION_ZONE_*` spellings are the
 * ones the Companion already reads (they were first written for the archived
 * `/location/zones`).
 */
export type TravTrackApiErrorCode =
  | "TRAVTRACK_DISABLED" // the instance does not capture or show TravTrack now (403)
  | "TRAVTRACK_DEVICE_REQUIRED" // positions come from a paired device only (403)
  | "LOCATION_ZONE_HOLDS_POINTS" // a new or grown zone would delete stored points: ask first (409)
  | "LOCATION_ZONE_LIMIT" // the account holds the most privacy zones there may be (409)
  | "LOCATION_ZONE_NOT_FOUND" // no such zone of this account (404)
  | "TRACK_SOURCE_NOT_AVAILABLE" // ?source= names a source holding nothing for the entry (404)
  | "TRAVTRACK_EXPORT_TOO_LONG"; // an export covers at most 366 days (400)
