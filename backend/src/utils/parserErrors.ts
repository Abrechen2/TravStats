/**
 * Map parser-pipeline failures to client-safe responses.
 *
 * LLM-connectivity failures (Ollama down, OpenAI/Claude unreachable,
 * timeouts) used to bubble their raw exception text — "connect
 * ECONNREFUSED 192.168.x.x:11434" — straight to the import modal.
 * Those are 503s with an actionable message; everything else stays a
 * 500 with the original message for debuggability.
 */
export function describeParserError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : 'Unknown error';
  const llmUnreachable =
    /ollama|econnrefused|econnreset|etimedout|fetch failed|socket hang up|network|timeout|abort/i.test(
      raw,
    );
  if (llmUnreachable) {
    return {
      status: 503,
      message:
        'The LLM parser is currently unreachable. Check the parser configuration in Settings (Ollama/OpenAI/Claude) or try again later.',
    };
  }
  return { status: 500, message: raw };
}
