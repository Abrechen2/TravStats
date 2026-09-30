import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ProviderAvailability,
  ParserConfig,
} from "./types";
import logger from "../../utils/logger";
import { llmRefusalFor } from "../llm/llmGate";
import { resolveLlmTarget } from "../llm/llmProvider";

// Availability cache (5 minutes TTL)
const availabilityCache = new Map<
  string,
  { availability: ProviderAvailability; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check provider availability with caching
 */
export async function checkProviderAvailability(
  parser: IVisionParser | ITextParser,
  apiKey?: string
): Promise<ProviderAvailability> {
  const cacheKey = `${parser.provider}-${apiKey || "default"}`;
  const cached = availabilityCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.availability;
  }

  const availability = await parser.checkAvailability(apiKey);
  availabilityCache.set(cacheKey, { availability, timestamp: Date.now() });

  return availability;
}

/**
 * Delete a single entry from the availability cache (e.g. after parse failure)
 */
export function deleteAvailabilityCacheEntry(cacheKey: string): void {
  availabilityCache.delete(cacheKey);
}

/**
 * Get default fallback chain for vision parsers
 */
export function getDefaultVisionFallbackChain(): VisionProvider[] {
  return ["tesseract", "manual"];
}

/**
 * Get default fallback chain for text parsers
 */
export function getDefaultTextFallbackChain(): TextProvider[] {
  return ["ollama", "regex"];
}

/**
 * Parse fallback chain from string (comma-separated)
 */
export function parseFallbackChain<T extends string>(
  chain: string | undefined,
  defaultChain: T[]
): T[] {
  if (!chain) return defaultChain;

  const providers = chain.split(",").map((p) => p.trim()) as T[];
  return providers.length > 0 ? providers : defaultChain;
}

/**
 * Get parser configuration
 * @param userId - Optional user ID for template lookup
 */
export async function getParserConfig(
  _userSettings?: Record<string, unknown>,
  _adminSettings?: Record<string, unknown>,
  userId?: string
): Promise<ParserConfig> {
  // No localhost default here: an instance with nothing configured has no
  // model, and `hasLlm`/`llmConfigured` must say so.
  const target = await resolveLlmTarget();

  /**
   * A refused caller gets a config with no model in it — the admin switch
   * (owner decision 2026-09-25) or the SHARED demo account (security audit of
   * 2026-09-19, finding 3), both answered by `llmRefusalFor`. Both of the
   * flight parser's fallthroughs to the LLM — `parseEmail`'s `llm_first`
   * branch and its provider chain — read this object, so emptying it here
   * closes both.
   *
   * For the demo account the URL and model resolved above are the ADMIN's
   * Ollama, lent to every caller; on a public preview whose demo password is
   * printed on the login page that would be the operator's hardware answering
   * strangers. The template readers cost nothing and run untouched; a document
   * no template knows takes the existing "not recognised" path.
   *
   * `ollama` LEAVES the fallback chain, it is not merely left unconfigured:
   * `getOllamaTextParser(undefined, undefined)` would fall back to
   * `OLLAMA_URL` or localhost on its own, so dropping the URL alone would
   * close nothing on an instance that sets the environment variable.
   */
  const llmRefusal = await llmRefusalFor(userId);
  const noLlm = llmRefusal !== null;

  return {
    visionProvider: "tesseract",
    textProvider: "regex",
    visionFallbacks: getDefaultVisionFallbackChain(),
    textFallbacks: noLlm
      ? getDefaultTextFallbackChain().filter((provider) => provider !== "ollama")
      : getDefaultTextFallbackChain(),
    ...(noLlm || !target ? {} : { llmTarget: target }),
    // Kept for readers that predate the provider choice; only an Ollama
    // target has an Ollama URL.
    ollamaUrl: noLlm || target?.kind !== "ollama" ? undefined : target.url,
    ollamaModel: noLlm || target?.kind !== "ollama" ? undefined : target.model,
    ...(llmRefusal ? { llmRefusal } : {}),
    userId,
  };
}

/**
 * Clear availability cache (useful for testing)
 */
export function clearAvailabilityCache(): void {
  availabilityCache.clear();
  logger.info("[Parser Factory] Availability cache cleared");
}
