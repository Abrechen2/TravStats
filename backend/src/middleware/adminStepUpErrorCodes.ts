/**
 * Why a Companion's admin step-up (`password` + `totp` in the body of a federation pin call,
 * spec 2026-11-02 §6) was refused. Part of `ApiErrorCode` (`apiErrorCode.ts`).
 */
export type AdminStepUpApiErrorCode =
  /** The account has two-factor on and the body carried no `totp`. */
  | "ADMIN_STEP_UP_TOTP_REQUIRED"
  /** Wrong password or wrong `totp`, or an account with no usable password (passkey-only). */
  | "ADMIN_STEP_UP_FAILED"
  /** Too many wrong step-up attempts for this account; retry after the lock window. */
  | "ADMIN_STEP_UP_LOCKED";
