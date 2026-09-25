/**
 * Extract a user-facing message from an Axios-style API error.
 *
 * The backend returns errors as `{ error: "<category>", message: "<cause>" }`
 * (see the route handlers). The `message` field carries the specific cause
 * (e.g. "Ollama is not reachable"), so we prefer it over the generic `error`
 * category, and fall back to the provided default when the response carries
 * neither — so callers never surface an empty string.
 */
export function extractApiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string; message?: string } } } | undefined)
    ?.response?.data;
  const candidate = data?.message ?? data?.error;
  return candidate && candidate.trim().length > 0 ? candidate : fallback;
}

/**
 * The machine-readable CODE an error body carries in its `error` field
 * ("DEMO_ACCOUNT_FORBIDDEN", "NOT_FOUND", ...), for callers that must
 * recognise one rather than print it.
 *
 * Printing it is the defect this exists to end: the receipt upload showed a
 * red "DEMO_ACCOUNT_FORBIDDEN" to the reader (auditor 3, 2026-09-19). A code
 * is a word for a program; it belongs in a condition, not on screen.
 */
export function apiErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { error?: string } } } | undefined)?.response?.data;
  return typeof data?.error === "string" && data.error.length > 0 ? data.error : null;
}

/**
 * The server's SENTENCE, and only that -- never the code beside it.
 *
 * `extractApiErrorMessage` falls back to the `error` field when there is no
 * message, which is right where that field carries prose and wrong where it
 * carries a code. A caller that has already recognised the codes it cares
 * about uses this instead, so an unrecognised one cannot leak to the screen.
 */
export function apiErrorMessage(err: unknown): string | null {
  const data = (err as { response?: { data?: { message?: string } } } | undefined)?.response?.data;
  return typeof data?.message === "string" && data.message.trim().length > 0 ? data.message : null;
}

/**
 * The `code` field — the backend's closed `ApiErrorCode` union, sent beside
 * the prose in `error`.
 *
 * Distinct from `apiErrorCode` above, which reads `error`: that field carries
 * a code only under the older convention (`DEMO_ACCOUNT_FORBIDDEN`) and prose
 * everywhere else. Anything thrown with `new AppError(message, status, code)`
 * lands here instead, and a client branching on the wrong one of the two
 * silently never matches.
 */
export function apiErrorMachineCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { code?: string } } } | undefined)?.response?.data;
  return typeof data?.code === "string" && data.code.length > 0 ? data.code : null;
}

/** The server's word for "the shared demo account may not do this". */
export const DEMO_FORBIDDEN_CODE = "DEMO_ACCOUNT_FORBIDDEN";
