import type { ParserConfig } from "./types";
import { ollamaTarget, type LlmTarget } from "../llm/llmProvider";

/**
 * The model endpoint a config carries: the resolved target, or — for a config
 * built by hand with only `ollamaUrl`/`ollamaModel` — an Ollama target from
 * those. Null when no model is configured.
 */
export function llmTargetOf(config: ParserConfig | undefined): LlmTarget | null {
  if (!config) return null;
  if (config.llmTarget) return config.llmTarget;
  return config.ollamaUrl ? ollamaTarget(config.ollamaUrl, config.ollamaModel) : null;
}
