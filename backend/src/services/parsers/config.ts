import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ProviderAvailability,
  ParserConfig,
} from './types';
import logger from '../../utils/logger';
import { getAdminParserSettings } from '../parserSettings';

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
  return ['tesseract', 'manual'];
}

/**
 * Get default fallback chain for text parsers
 */
export function getDefaultTextFallbackChain(): TextProvider[] {
  return ['ollama', 'regex'];
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

  return {
    visionProvider: 'tesseract',
    textProvider: 'regex',
    visionFallbacks: getDefaultVisionFallbackChain(),
    textFallbacks: getDefaultTextFallbackChain(),
    ollamaUrl: ollamaUrl ?? undefined,
    ollamaModel: ollamaModel ?? undefined,
    userId,
  };
}

/**
 * Clear availability cache (useful for testing)
 */
export function clearAvailabilityCache(): void {
  availabilityCache.clear();
  logger.info('[Parser Factory] Availability cache cleared');
}
