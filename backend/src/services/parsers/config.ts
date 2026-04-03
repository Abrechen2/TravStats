import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ProviderAvailability,
  ParserConfig,
} from './types';
import logger from '../../utils/logger';

// Availability cache (5 minutes TTL)
const availabilityCache = new Map<string, { availability: ProviderAvailability; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check provider availability with caching
 */
export async function checkProviderAvailability(
  parser: IVisionParser | ITextParser,
  apiKey?: string
): Promise<ProviderAvailability> {
  const cacheKey = `${parser.provider}-${apiKey || 'default'}`;
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
  // Priority: Cloud AI > Local AI > OCR > Manual
  return ['openai', 'claude', 'ollama', 'tesseract', 'manual'];
}

/**
 * Get default fallback chain for text parsers
 */
export function getDefaultTextFallbackChain(): TextProvider[] {
  // Priority: Cloud AI > Local AI > Regex
  return ['openai', 'claude', 'ollama', 'regex'];
}

/**
 * Parse fallback chain from string (comma-separated)
 */
export function parseFallbackChain<T extends string>(chain: string | undefined, defaultChain: T[]): T[] {
  if (!chain) return defaultChain;

  const providers = chain.split(',').map((p) => p.trim()) as T[];
  return providers.length > 0 ? providers : defaultChain;
}

/**
 * Get parser configuration from environment and user settings
 * @param userSettings - User settings (API keys should already be decrypted)
 * @param adminSettings - Optional admin settings (API keys should already be decrypted)
 */
export async function getParserConfig(
  userSettings?: {
    preferredVisionParser?: string | null;
    preferredTextParser?: string | null;
    visionFallbackChain?: string | null;
    textFallbackChain?: string | null;
    openaiApiKey?: string | null;
    claudeApiKey?: string | null;
  },
  adminSettings?: {
    globalOpenaiApiKey?: string | null;
    globalClaudeApiKey?: string | null;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
    ollamaVisionModel?: string | null;
  },
  userId?: string
): Promise<ParserConfig> {
  // Import here to avoid circular dependency
  const { selectModelForParsing } = await import('../modelManager');

  // Select models based on user settings and availability
  const selectedEmailModel = await selectModelForParsing('email', userId);
  const selectedVisionModel = await selectModelForParsing('vision', userId);
  // Note: API keys in userSettings and adminSettings should already be decrypted when passed to this function
  // Priority: userSettings API keys > adminSettings global keys > environment variables
  return {
    visionProvider: (userSettings?.preferredVisionParser as VisionProvider | 'auto') || 'auto',
    textProvider: (userSettings?.preferredTextParser as TextProvider | 'auto') || 'auto',
    visionFallbacks: parseFallbackChain(
      userSettings?.visionFallbackChain || undefined,
      getDefaultVisionFallbackChain()
    ),
    textFallbacks: parseFallbackChain(
      userSettings?.textFallbackChain || undefined,
      getDefaultTextFallbackChain()
    ),
    ollamaUrl: adminSettings?.ollamaUrl || process.env.OLLAMA_URL,
    ollamaModel: adminSettings?.ollamaModel || selectedEmailModel,
    ollamaVisionModel: adminSettings?.ollamaVisionModel || selectedVisionModel,
    openaiApiKey: userSettings?.openaiApiKey || adminSettings?.globalOpenaiApiKey || process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    openaiVisionModel: process.env.OPENAI_VISION_MODEL,
    claudeApiKey: userSettings?.claudeApiKey || adminSettings?.globalClaudeApiKey || process.env.CLAUDE_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL,
    claudeVisionModel: process.env.CLAUDE_VISION_MODEL,
    userId,
  };
}

/**
 * Clear availability cache (useful for testing API keys)
 */
export function clearAvailabilityCache(): void {
  availabilityCache.clear();
  logger.info('[Parser Factory] Availability cache cleared');
}
