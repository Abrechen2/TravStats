import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "./apiError";
import { MissingZoneError } from "./api/timeInput";

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
  // ADR 0002 D2 keeps these two apart: 503 — the lookup itself cannot run
  // (the server is at fault); 422 — it ran and this place has no zone.
  TIMEZONE_LOOKUP_UNAVAILABLE: "common:saveErrors.timezoneUnavailable",
  TZ_UNRESOLVED: "common:saveErrors.timezoneUnresolved",
  // The time model's refusals (ADR 0002, D3). A typed hour the clock change
  // skips; a zone name the server's tzdata does not know; and a body in the
  // pre-time-model shape — which only a browser still running the bundle
  // from before the update sends, so the sentence asks for a reload.
  LOCAL_TIME_NONEXISTENT: "common:saveErrors.localTimeNonexistent",
  ZONE_UNKNOWN: "common:saveErrors.zoneUnknown",
  TIME_SHAPE_REQUIRED: "common:saveErrors.staleBundle",
};

/**
 * A create whose answer never came back. The record may or may not exist, so
 * the sentence must not invite the blind second try that files it twice.
 */
export const OUTCOME_UNKNOWN_KEY = "common:saveErrors.outcomeUnknown";

/** What a form says about the request it is saving — see `saveErrorKey`. */
export interface SaveErrorOptions {
  /**
   * The request CREATES a record. A create has no idempotency key, so when its
   * outcome is unknown (timeout, a connection that dropped after the request
   * was sent, a gateway that gave up) the failure reads `OUTCOME_UNKNOWN_KEY`
   * instead of "network", and offers no retry (bus review, Minor 2). Default
   * `false`: an update (PATCH/PUT of an existing entry) is idempotent and may
   * be sent again as before.
   */
  create?: boolean;
}

/**
 * Gateway statuses that say "the proxy gave up", not "the server refused":
 * the application behind it may well have stored the record. 503 and 429 are
 * NOT here — those are answers the server (or its limiter) gave before doing
 * any work.
 */
function isGatewayGiveUp(status: number | undefined): boolean {
  return (
    status === 502 || status === 504 || (status !== undefined && status >= 520 && status <= 524)
  );
}

/**
 * Did the request possibly reach the server without its answer coming back?
 * No response at all (timeout, dropped connection) or a gateway that gave up.
 * A browser that is offline NOW counts as "never left": the usual cause is
 * that it was offline when the user pressed Save, and a retry is the cure.
 */
function isOutcomeUnknown(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const response = (err as { response?: { status?: number } }).response;
  if (response) return isGatewayGiveUp(response.status);
  if (!("isAxiosError" in err)) return false;
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

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
  extraCodeKeys: Readonly<Record<string, string>> = {},
  options: SaveErrorOptions = {}
): string {
  return t(saveErrorKey(err, fallbackKey, extraCodeKeys, options));
}

/**
 * The translation KEY `saveErrorMessage` shows — for a form that keeps the key
 * (and a field) in its own state, such as the rail editor. One rule, one home:
 * every save dialog reads a failure through here.
 */
export function saveErrorKey(
  err: unknown,
  fallbackKey: string,
  extraCodeKeys: Readonly<Record<string, string>> = {},
  options: SaveErrorOptions = {}
): string {
  // Refused before the request: the picked place brought no zone source.
  if (err instanceof MissingZoneError) return SHARED_CODE_KEYS.TZ_UNRESOLVED;
  const code = apiErrorMachineCode(err);
  if (code) {
    const key = extraCodeKeys[code] ?? SHARED_CODE_KEYS[code];
    if (key) return key;
  }
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "common:saveErrors.demo";
  if (options.create === true && isOutcomeUnknown(err)) return OUTCOME_UNKNOWN_KEY;
  const response = (err as { response?: { status?: number } } | null)?.response;
  if (response?.status === 429) return SHARED_CODE_KEYS.RATE_LIMITED;
  if (err !== null && typeof err === "object" && "isAxiosError" in err && !response) {
    return "common:saveErrors.network";
  }
  return fallbackKey;
}

/**
 * The failures where pressing the same button again is the likely cure — a
 * dropped connection, a database that is restarting, a rate limit. A form
 * offers "Erneut versuchen" for these and NOT for a refusal of the input
 * itself, where a retry would only be refused again. One home, so the eight
 * forms that offer a retry cannot disagree about when.
 */
const TRANSIENT_KEYS: ReadonlySet<string> = new Set([
  "common:saveErrors.network",
  "common:saveErrors.dbUnavailable",
  "common:saveErrors.rateLimited",
]);

/** Takes the key `saveErrorKey` returned. */
export function isTransientSaveError(key: string): boolean {
  return TRANSIENT_KEYS.has(key);
}

/**
 * Takes the key `saveErrorKey` returned: true when a create may or may not
 * have been stored. The form shows no retry for it and, if it can, a "Liste
 * neu laden" (`FormErrorBanner`'s `onReload`) so the user can look first.
 */
export function isOutcomeUnknownSaveError(key: string): boolean {
  return key === OUTCOME_UNKNOWN_KEY;
}
