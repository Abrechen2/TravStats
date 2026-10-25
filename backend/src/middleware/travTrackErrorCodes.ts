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
  | "TRAVTRACK_NOT_ACTIVE" // this account's location provider is not a working TravTrack (403/409)
  | "LOCATION_ZONE_HOLDS_POINTS" // a new or grown zone would delete stored points: ask first (409)
  | "LOCATION_ZONE_LIMIT" // the account holds the most privacy zones there may be (409)
  | "LOCATION_ZONE_NOT_FOUND" // no such zone of this account (404)
  | "TRACK_SOURCE_NOT_AVAILABLE" // ?source= names a source holding nothing for the entry (404)
  | "TRAVTRACK_EXPORT_TOO_LONG" // an export covers at most 366 days (400)
  | "TRAVTRACK_ROUTE_EMPTY" // a route snapshot was asked for, but nothing of the trip may be shown (409)
  | "TRAVTRACK_ROUTE_BUILD_RATE_LIMITED" // too many route snapshot builds by this account just now (429)
  | "TRAVTRACK_SHARE_BUSY" // the pending route row was removed before each of three builds (a failed share, a revoke); try again (409)
  | "SHARED_ROUTE_NOT_FOUND"; // no member of this shared trip shares its route with the reader (404)
