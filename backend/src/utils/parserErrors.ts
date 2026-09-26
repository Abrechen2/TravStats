import type { ApiErrorCode } from "../middleware/errorHandler";

/**
 * Map parser-pipeline failures to client-safe responses.
 *
 * LLM-connectivity failures (Ollama down, OpenAI/Claude unreachable,
 * timeouts) used to bubble their raw exception text — "connect
 * ECONNREFUSED 192.168.x.x:11434" — straight to the import modal.
 * Those are 503s with an actionable message; everything else is a 500.
 *
 * Every answer carries a stable `code` the client maps to its own copy. The
 * 500's `message` used to be the raw exception text "for debuggability", and
 * the import dialog printed it into a German page; the cause belongs in the
 * server log, which every caller writes before answering.
 */
export function describeParserError(error: unknown): {
  status: number;
  message: string;
  code: ApiErrorCode;
} {
  const raw = error instanceof Error ? error.message : "Unknown error";
  const llmUnreachable =
    /ollama|econnrefused|econnreset|etimedout|fetch failed|socket hang up|network|timeout|abort/i.test(
      raw
    );
  if (llmUnreachable) {
    return {
      status: 503,
      message:
        "The LLM parser is currently unreachable. Check the parser configuration in Settings (Ollama/OpenAI/Claude) or try again later.",
      code: "LLM_UNREACHABLE",
    };
  }
  return {
    status: 500,
    message: "Parsing failed. The cause is in the server log.",
    code: "PARSE_FAILED",
  };
}
