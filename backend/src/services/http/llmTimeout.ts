/**
 * How long a document parser may wait for the local model — ONE number, for
 * all three domains.
 *
 * The number is not a guess at how long a model takes. It is the share of the
 * REQUEST it is allowed to spend, and that is the mistake the three parsers
 * were making independently: the flight and cruise parsers waited 300 s, the
 * lodging parser 120 s, and every one of those budgets is longer than the
 * request itself survives.
 *
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-LLM-TIMEOUT-001): a model
 * that accepted `/api/generate` and then never answered had `/parse-email`
 * killed by the reverse proxy after exactly 60.0 s with HTTP 504 and a
 * non-JSON body. The parser was still waiting — it had 240 s of its own budget
 * left — so the caller received no parser diagnosis AND no regex fallback,
 * although the fallback chain in `parsers/email.ts` catches a failing provider
 * and carries on. A budget the client never lives to see is not a budget; it
 * is a guarantee that the slow case ends in nothing.
 *
 * 45 s therefore, which is what fits: nginx's `proxy_read_timeout` default is
 * 60 s and the deployment measured above cut at exactly that, so the model
 * gets 45 and the template/regex fallback plus the response get the remaining
 * 15. An instance reached directly on the LAN has no such ceiling and may run
 * a model that needs longer — hence `LLM_PARSE_TIMEOUT_MS`, which is also how
 * the suites shrink it to milliseconds.
 *
 * Raising it above the deployment's own proxy timeout re-creates the finding,
 * so raise that first.
 */
export const DEFAULT_LLM_PARSE_TIMEOUT_MS = 45_000;

/** Availability probe — a `GET /api/tags` that is slow is already an answer. */
export const LLM_AVAILABILITY_TIMEOUT_MS = 5_000;

/**
 * A generate answer is one JSON document of a few kilobytes; anything near
 * this is a server misbehaving, not a long confirmation.
 */
export const LLM_MAX_RESPONSE_BYTES = 2_000_000;

function positiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The budget for one generate call.
 *
 * Read at CALL time, never at module load, so a suite can shrink it without
 * re-importing the parser — the convention the lodging parser established.
 *
 * @param overrideEnvVar a domain-specific variable that wins when it is set,
 *   kept for `LODGING_OLLAMA_TIMEOUT_MS`, which suites already use.
 */
export function llmParseTimeoutMs(overrideEnvVar?: string): number {
  const override = overrideEnvVar ? positiveNumber(process.env[overrideEnvVar]) : null;
  return (
    override ?? positiveNumber(process.env.LLM_PARSE_TIMEOUT_MS) ?? DEFAULT_LLM_PARSE_TIMEOUT_MS
  );
}
