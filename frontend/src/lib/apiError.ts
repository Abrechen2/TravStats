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
  const data = (
    err as { response?: { data?: { error?: string; message?: string } } } | undefined
  )?.response?.data;
  const candidate = data?.message ?? data?.error;
  return candidate && candidate.trim().length > 0 ? candidate : fallback;
}
