/**
 * Why a life book could not be built or fetched
 * (docs/superpowers/specs/2026-11-22-life-book.md). Part of `ApiErrorCode`
 * (`apiErrorCode.ts`); the settings page maps each to DE/EN copy.
 */
export type LifeBookApiErrorCode =
  /** The request body is not a valid scope (400). */
  | "LIFE_BOOK_INVALID"
  /** A build for this account is already running (409). */
  | "LIFE_BOOK_BUSY"
  /** Nothing in the chosen scope to put into a book (422). */
  | "LIFE_BOOK_EMPTY"
  /** The book would exceed `LIFE_BOOK_MAX_BYTES`: pick a year or one trip (413). */
  | "LIFE_BOOK_TOO_LARGE"
  /** The book is unknown, expired or someone else's (404). */
  | "LIFE_BOOK_NOT_FOUND";
