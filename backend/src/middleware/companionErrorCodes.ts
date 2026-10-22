/**
 * Why a change to the companion catalogue was refused (Settings → Mitreisende).
 * Part of `ApiErrorCode` (`errorHandler.ts`), kept here because that file sits
 * at its size limit; the frontend maps each to DE/EN copy
 * (`components/Settings/companions/companionErrorCopy.ts`).
 */
export type CompanionApiErrorCode =
  /** A rename onto a name another companion already has (409). `extra` names it, so the UI can offer to merge instead. */
  | "COMPANION_NAME_TAKEN"
  /** A merge of a companion into itself (400). */
  | "COMPANION_MERGE_SELF"
  /** Both companions are linked to DIFFERENT accounts (409): merging would widen sharing silently. */
  | "COMPANION_MERGE_LINK_CONFLICT"
  /** A delete of a companion still on entries, paying expenses or linked to an account (409). */
  | "COMPANION_IN_USE";
