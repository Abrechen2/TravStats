import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "./apiError";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Server codes (`ApiErrorCode`, backend `middleware/errorHandler.ts`) that
 * mean the same thing on every form, with the sentence each one gets.
 */
const SHARED_CODE_KEYS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: "common:saveErrors.validation",
  DUPLICATE: "common:saveErrors.duplicate",
  DB_UNAVAILABLE: "common:saveErrors.dbUnavailable",
  RATE_LIMITED: "common:saveErrors.rateLimited",
};

/**
 * The sentence a failed save shows, in the reader's language.
 *
 * Never the server's `error` text: that is English prose written for a log —
 * or, for a refused body, zod's JSON issue dump, which the cruise and stay
 * editors printed verbatim into a German page until 2026-09-26. A code the
 * caller knows better (`extraCodeKeys`) wins over the shared ones; anything
 * unrecognised falls back to the form's own generic key.
 */
export function saveErrorMessage(
  err: unknown,
  t: Translate,
  fallbackKey: string,
  extraCodeKeys: Readonly<Record<string, string>> = {}
): string {
  return t(saveErrorKey(err, fallbackKey, extraCodeKeys));
}

/**
 * The translation KEY `saveErrorMessage` shows — for a form that keeps the key
 * (and a field) in its own state, such as the rail editor. One rule, one home:
 * every save dialog reads a failure through here.
 */
export function saveErrorKey(
  err: unknown,
  fallbackKey: string,
  extraCodeKeys: Readonly<Record<string, string>> = {}
): string {
  const code = apiErrorMachineCode(err);
  if (code) {
    const key = extraCodeKeys[code] ?? SHARED_CODE_KEYS[code];
    if (key) return key;
  }
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "common:saveErrors.demo";
  const response = (err as { response?: { status?: number } } | null)?.response;
  if (response?.status === 429) return SHARED_CODE_KEYS.RATE_LIMITED;
  if (err !== null && typeof err === "object" && "isAxiosError" in err && !response) {
    return "common:saveErrors.network";
  }
  return fallbackKey;
}
