import { apiErrorMachineCode } from "../../../lib/apiError";

const REASONS = new Set([
  "serviceOff",
  "notConfigured",
  "internetOff",
  "privateTarget",
  "invalidUrl",
  "timeout",
  "unreachable",
  "badResponse",
  "tooLarge",
  "tooFewPoints",
  "lowConfidence",
]);

/** The copy key of a failed road match: the server's reason, or the transport's. */
export function matchFailureKey(error: unknown): string {
  const reason = (error as { response?: { data?: { reason?: unknown } } } | null)?.response?.data
    ?.reason;
  if (apiErrorMachineCode(error) === "MAP_MATCH_FAILED" && typeof reason === "string") {
    return `track:cleanup.error.${REASONS.has(reason) ? reason : "badResponse"}`;
  }
  if ((error as { code?: string } | null)?.code === "ECONNABORTED")
    return "track:cleanup.error.timeout";
  return "track:cleanup.error.unreachable";
}
