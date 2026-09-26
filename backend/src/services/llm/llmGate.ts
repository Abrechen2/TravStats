/**
 * Whether a language model may be asked anything — ONE home for the answer.
 *
 * Owner decision 2026-09-25: an admin can turn the model off. Before that the
 * only way to keep a document away from Ollama was to leave the URL empty,
 * and even that did not hold: every Ollama caller fell back to `OLLAMA_URL`
 * from the environment, and the `USE_LLM_PARSER` variable that looked like a
 * switch was read by nothing (measured 2026-09-01). An operator who wanted
 * deterministic parses, or wanted no mail text leaving the box, had no say.
 *
 * Two layers, on purpose:
 *
 *  1. `llmRefusalFor(userId)` is what a PIPELINE asks before it even probes the
 *     model, so a refused parse takes the same "templates only" path an
 *     instance without a model takes, with a reason the UI can show. It also
 *     carries the shared-demo denial (security audit of 2026-09-19, finding 3),
 *     which used to be asked separately in three places.
 *  2. `assertLlmEnabled()` sits directly in front of every `/api/generate`
 *     request. A pipeline that forgot layer 1 fails closed here instead of
 *     quietly sending the document. `llmGate.entryPoints.test.ts` scans the
 *     source for model endpoints and fails for any file that talks to one
 *     without calling this — so a new caller cannot bypass the switch by
 *     simply not knowing about it.
 *
 * The switch covers the trip summary as well as parsing. There is no separate
 * summary toggle (its beta gate was removed on 2026-09-18), and the owner's
 * rule was "off = never a model call"; a summary is a model call.
 */

import { AppError } from "../../middleware/errorHandler";
import { getAdminParserSettings } from "../parserSettings";
import { isSharedDemoUser } from "../../utils/sharedDemo";

/** Why a model was not asked. Distinct kinds, because the UI says different things. */
export type LlmRefusalKind = "disabled_by_admin" | "shared_demo";

export interface LlmRefusal {
  kind: LlmRefusalKind;
  /** The sentence a parse response carries as `fallbackReason`. */
  reason: string;
}

export const LLM_DISABLED_REASON =
  "The AI parser is turned off by the administrator — only the built-in templates were tried.";

/**
 * What the shared demo account is told instead of an Ollama endpoint. It names
 * the account rather than the endpoint: an unreachable-Ollama reason quotes the
 * admin's URL, which is not the shared account's business.
 */
export const DEMO_NO_LLM_REASON =
  "The AI parser is not available for the shared demo account — only the built-in templates were tried.";

/**
 * The admin switch. No settings row means a fresh instance, which gets the
 * column's own default — on — so an instance configured purely through the
 * environment keeps parsing with its model until an admin says otherwise.
 */
export async function isLlmEnabledByAdmin(): Promise<boolean> {
  const settings = await getAdminParserSettings();
  return settings?.llmEnabled ?? true;
}

/**
 * Whether THIS caller's document may go to the model, and if not, why.
 * The admin switch is asked first: it is the broader refusal, and the reason
 * it gives is the one that is true for everyone on the instance.
 */
export async function llmRefusalFor(userId?: string): Promise<LlmRefusal | null> {
  if (!(await isLlmEnabledByAdmin())) {
    return { kind: "disabled_by_admin", reason: LLM_DISABLED_REASON };
  }
  if (userId !== undefined && (await isSharedDemoUser(userId))) {
    return { kind: "shared_demo", reason: DEMO_NO_LLM_REASON };
  }
  return null;
}

/**
 * The last line in front of a model request. 503 with a stable code, so a
 * route that reaches it without asking `llmRefusalFor` first still answers
 * something a client can tell apart from "the model is down".
 */
export async function assertLlmEnabled(): Promise<void> {
  if (!(await isLlmEnabledByAdmin())) {
    throw new AppError(LLM_DISABLED_REASON, 503, "LLM_DISABLED");
  }
}
