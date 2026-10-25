/**
 * The error codes of what location history suggests to TravStats and of
 * TravTrack's further sources (TravTrack plan, phase 3). Part of `ApiErrorCode`
 * through `LocationProviderApiErrorCode`, kept here because `errorHandler.ts`
 * is at its size limit.
 */
export type LocationEvidenceApiErrorCode =
  | "EVIDENCE_INVALIDATED" // the finding's history changed or was deleted while it was accepted (409)
  | "HISTORY_CHANGED" // the location history kept changing while the suggestion was accepted; it stays open — retry (409)
  | "EVIDENCE_UNVERIFIABLE" // the finding's evidence cannot be checked right now (map data missing); it stays open — retry later (409)
  | "SUGGESTION_ALREADY_RESOLVED" // the suggestion was answered already (409)
  | "SUGGESTION_ACCEPT_IN_PROGRESS" // another accept of the same suggestion is running; retry (409)
  | "SUGGESTION_NOT_FOUND" // no such suggestion of this account — or it went with deleted history (404)
  | "INGEST_TOKEN_INVALID" // unknown, revoked or other-kind OwnTracks/Overland token (401)
  | "TRAVTRACK_IMPORT_NO_TIMES" // the imported file holds no point with a time
  | "TRAVTRACK_IMPORT_UNREADABLE" // the imported file could not be read
  | "TRAVTRACK_IMPORT_TOO_MANY_POINTS" // the imported file holds more fixes than one import takes
  | "TRAVTRACK_IMPORT_RUNNING" // an import of this account is running already (409)
  | "TRAVTRACK_IMPORT_NOT_FOUND"; // no such import of this account (404)
