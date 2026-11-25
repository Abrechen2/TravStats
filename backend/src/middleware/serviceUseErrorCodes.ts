/**
 * Codes of the confirmed outbound uses (rc46 extras): the AI help for an
 * ambiguous suggestion and the map matching of a track. Part of `ApiErrorCode`;
 * the web maps each `reason` to DE/EN copy.
 */
export type ServiceUseApiErrorCode =
  /** The account has not confirmed this service at this target yet (409, body carries `disclosure`). */
  | "CONFIRMATION_REQUIRED"
  /** The AI help could not answer; `reason` names why (409/502/504). */
  | "AI_HELP_FAILED"
  /** A stretch could not be matched to roads; `reason` names why (409/502/504). */
  | "MAP_MATCH_FAILED";
