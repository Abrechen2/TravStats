import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ProviderAvailability,
  ParserConfig,
} from "./types";
import logger from "../../utils/logger";
import { getAdminParserSettings } from "../parserSettings";
import { isSharedDemoUser } from "../../utils/sharedDemo";

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
  const adminSettings = await getAdminParserSettings();

  const ollamaUrl = adminSettings?.ollamaUrl ?? process.env.OLLAMA_URL ?? undefined;
  const ollamaModel = adminSettings?.ollamaModel ?? process.env.OLLAMA_MODEL ?? undefined;

  /**
   * The SHARED demo account gets a config with no model in it — the ONE of the
   * flight parser's three fallthroughs to the LLM, since both `parseEmail`'s
   * `llm_first` branch and its provider chain read this object (security audit
   * of 2026-09-19, finding 3).
   *
   * The URL and the model resolved here are the ADMIN's Ollama, lent to every
   * caller. On a public preview whose demo password is printed on the login
   * page that is the operator's hardware answering strangers, minutes per
   * document, for as long as anyone cares to paste mails in — and the
   * summarize route is guarded against exactly that while the parse door
   * beside it stood open.
   *
   * The same shape as `services/immich/immichResolver.ts` returning `null`:
   * nothing new is thrown and no route is refused, because the answer is
   * byte-identical to an instance with no LLM configured. The template readers
   * — known airlines, booking.com, AIDA/TUI — are what a visitor came to try
   * and cost nothing, so they run untouched; a document no template knows
   * takes the existing "not recognised" path instead of the model.
   *
   * `ollama` LEAVES the fallback chain, it is not merely left unconfigured:
   * `getOllamaTextParser(undefined, undefined)` would fall back to
   * `OLLAMA_URL` or localhost on its own, so dropping the URL alone would
   * close nothing on an instance that sets the environment variable.
   */
  const noLlm = userId !== undefined && (await isSharedDemoUser(userId));

  return {
    visionProvider: "tesseract",
    textProvider: "regex",
    visionFallbacks: getDefaultVisionFallbackChain(),
    textFallbacks: noLlm
      ? getDefaultTextFallbackChain().filter((provider) => provider !== "ollama")
      : getDefaultTextFallbackChain(),
    ollamaUrl: noLlm ? undefined : (ollamaUrl ?? undefined),
    ollamaModel: noLlm ? undefined : (ollamaModel ?? undefined),
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
