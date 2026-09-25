import { getParserConfig } from "../parsers/config";

export interface ParserCapabilities {
  /** A model is configured AND allowed — what the import screen warns about. */
  hasLlm: boolean;
  /**
   * The admin switched the model off (`llmGate.ts`). Kept apart from `hasLlm`
   * because the two absences need different sentences: "no model is set up"
   * sends an admin to the Ollama settings, "turned off" tells a user that
   * templates-only is a decision, not a fault.
   */
  llmDisabledByAdmin: boolean;
}

/**
 * Answered from the SAME resolution the parser uses.
 *
 * Forgejo #12: this used to read `admin_settings` alone, while `getParserConfig`
 * also falls back to OLLAMA_URL / OLLAMA_MODEL from the environment. On any
 * instance configured through env — which is how the test VM installer sets it
 * up — the import screen said "Kein LLM-Parser verfuegbar" while the very next
 * request came back labelled `ollama` with 85% confidence. Two sources of truth
 * for one question is how they disagreed; there is one now.
 */
export async function getParserCapabilities(): Promise<ParserCapabilities> {
  const config = await getParserConfig();
  return {
    hasLlm: Boolean(config.ollamaUrl && config.ollamaModel),
    llmDisabledByAdmin: config.llmRefusal?.kind === "disabled_by_admin",
  };
}
