/**
 * Tour-track failure codes (backend `routes/trips/tourTracks.ts`, members of
 * `ApiErrorCode`) and the DE/EN sentence each one gets. The upload and the
 * Dawarich pull used to show one generic line for all of them — or, per the
 * doc comments, the server's English prose.
 */
export const TRACK_ERROR_KEYS: Readonly<Record<string, string>> = {
  TRACK_FILE_TOO_LARGE: "trips:tours.tracks.errors.fileTooLarge",
  TRACK_FILE_UNREADABLE: "trips:tours.tracks.errors.fileUnreadable",
  TRACK_NO_TIMESTAMPS: "trips:tours.tracks.errors.noTimestamps",
  TRACK_ALREADY_IMPORTED: "trips:tours.tracks.errors.alreadyImported",
  DAWARICH_NO_DATED_STOPS: "trips:tours.tracks.errors.noDatedStops",
  DAWARICH_WINDOW_INVALID: "trips:tours.tracks.errors.windowInvalid",
  DAWARICH_WINDOW_EMPTY: "trips:tours.tracks.errors.windowEmpty",
  DAWARICH_TOO_FEW_POINTS: "trips:tours.tracks.errors.tooFewPoints",
};
