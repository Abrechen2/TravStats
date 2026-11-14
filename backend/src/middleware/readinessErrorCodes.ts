/** Why a readiness request was refused (setup & readiness). Part of `ApiErrorCode`. */
export type ReadinessApiErrorCode =
  /** No such item, or it does not apply to this account (404). */
  | "READINESS_ITEM_NOT_FOUND"
  /** No such update note, or it is not shown to this account (404). */
  | "READINESS_NOTE_NOT_FOUND"
  /** A required item cannot be opted out of (409). */
  | "READINESS_OPT_OUT_NOT_ALLOWED";
