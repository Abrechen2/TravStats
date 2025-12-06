import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ProviderAvailability,
  ParserConfig,
  ParserResult,
} from './types';
import { ParsedBooking } from '../bookingParser';
import logger from '../../utils/logger';

// Import all vision parsers
import { getOllamaVisionParser } from './vision/ollamaVisionParser';
import { getOpenAIVisionParser } from './vision/openaiVisionParser';
import { getClaudeVisionParser } from './vision/claudeVisionParser';
import { getTesseractParser } from './vision/tesseractParser';
import { getManualParser } from './vision/manualParser';

// Import all text parsers
import { getOllamaTextParser } from './text/ollamaTextParser';
import { getOpenAITextParser } from './text/openaiTextParser';
import { getClaudeTextParser } from './text/claudeTextParser';
import { getRegexParser } from './text/regexParser';

/**
 * Parser Factory
 *
 * Manages parser selection, auto-mode, and fallback chains.
 * Supports both global (admin) and user-specific API keys.
 */

// Availability cache (5 minutes TTL)
const availabilityCache = new Map<string, { availability: ProviderAvailability; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get vision parser instance by provider
 */
function getVisionParserInstance(provider: VisionProvider): IVisionParser {
  switch (provider) {
    case 'ollama':
      return getOllamaVisionParser();
    case 'openai':
      return getOpenAIVisionParser();
    case 'claude':
      return getClaudeVisionParser();
    case 'tesseract':
      return getTesseractParser();
    case 'manual':
      return getManualParser();
    default:
      throw new Error(`Unknown vision provider: ${provider}`);
  }
}

/**
 * Get text parser instance by provider
 */
function getTextParserInstance(provider: TextProvider): ITextParser {
  switch (provider) {
    case 'ollama':
      return getOllamaTextParser();
    case 'openai':
      return getOpenAITextParser();
    case 'claude':
      return getClaudeTextParser();
    case 'regex':
      return getRegexParser();
    default:
      throw new Error(`Unknown text provider: ${provider}`);
  }
}

/**
 * Check provider availability with caching
 */
async function checkProviderAvailability(
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
 * Get default fallback chain for vision parsers
 */
function getDefaultVisionFallbackChain(): VisionProvider[] {
  // Priority: Cloud AI > Local AI > OCR > Manual
  return ['openai', 'claude', 'ollama', 'tesseract', 'manual'];
}

/**
 * Get default fallback chain for text parsers
 */
function getDefaultTextFallbackChain(): TextProvider[] {
  // Priority: Cloud AI > Local AI > Regex
  return ['openai', 'claude', 'ollama', 'regex'];
}

/**
 * Parse fallback chain from string (comma-separated)
 */
function parseFallbackChain<T extends string>(chain: string | undefined, defaultChain: T[]): T[] {
  if (!chain) return defaultChain;

  const providers = chain.split(',').map((p) => p.trim()) as T[];
  return providers.length > 0 ? providers : defaultChain;
}

/**
 * Get parser configuration from environment and user settings
 */
export function getParserConfig(userSettings?: {
  preferredVisionParser?: string | null;
  preferredTextParser?: string | null;
  visionFallbackChain?: string | null;
  textFallbackChain?: string | null;
  openaiApiKey?: string | null;
  claudeApiKey?: string | null;
}): ParserConfig {
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
    ollamaUrl: process.env.OLLAMA_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    ollamaVisionModel: process.env.OLLAMA_VISION_MODEL,
    openaiApiKey: userSettings?.openaiApiKey || process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    openaiVisionModel: process.env.OPENAI_VISION_MODEL,
    claudeApiKey: userSettings?.claudeApiKey || process.env.CLAUDE_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL,
    claudeVisionModel: process.env.CLAUDE_VISION_MODEL,
  };
}

/**
 * Get vision parser with fallback support
 */
export async function getVisionParser(
  config: ParserConfig
): Promise<{ parser: IVisionParser; provider: VisionProvider; fallbackUsed: boolean }> {
  logger.info(
    {
      preferred: config.visionProvider,
      fallbackChain: config.visionFallbacks,
    },
    '[Parser Factory] Resolving vision parser'
  );

  // If specific provider requested (not auto)
  if (config.visionProvider !== 'auto') {
    const parser = getVisionParserInstance(config.visionProvider);
    const apiKey = config.visionProvider === 'openai' ? config.openaiApiKey :
                   config.visionProvider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      logger.info(`[Parser Factory] Using requested vision parser: ${config.visionProvider}`);
      return { parser, provider: config.visionProvider, fallbackUsed: false };
    }

    logger.warn(`[Parser Factory] Requested vision parser '${config.visionProvider}' unavailable: ${availability.reason}`);
  }

  // Auto mode or fallback: try each provider in chain
  for (const provider of config.visionFallbacks) {
    const parser = getVisionParserInstance(provider);
    const apiKey = provider === 'openai' ? config.openaiApiKey :
                   provider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      const fallbackUsed = config.visionProvider !== 'auto' && config.visionProvider !== provider;
      logger.info(`[Parser Factory] Using vision parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      return { parser, provider, fallbackUsed };
    }

    logger.debug(`[Parser Factory] Vision parser '${provider}' unavailable: ${availability.reason}`);
  }

  // Ultimate fallback: manual parser (always available)
  logger.warn('[Parser Factory] All vision parsers unavailable, using manual fallback');
  const manualParser = getManualParser();
  return { parser: manualParser, provider: 'manual', fallbackUsed: true };
}

/**
 * Get text parser with fallback support
 */
export async function getTextParser(
  config: ParserConfig
): Promise<{ parser: ITextParser; provider: TextProvider; fallbackUsed: boolean }> {
  logger.info(
    {
      preferred: config.textProvider,
      fallbackChain: config.textFallbacks,
    },
    '[Parser Factory] Resolving text parser'
  );

  // If specific provider requested (not auto)
  if (config.textProvider !== 'auto') {
    const parser = getTextParserInstance(config.textProvider);
    const apiKey = config.textProvider === 'openai' ? config.openaiApiKey :
                   config.textProvider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      logger.info(`[Parser Factory] Using requested text parser: ${config.textProvider}`);
      return { parser, provider: config.textProvider, fallbackUsed: false };
    }

    logger.warn(`[Parser Factory] Requested text parser '${config.textProvider}' unavailable: ${availability.reason}`);
  }

  // Auto mode or fallback: try each provider in chain
  for (const provider of config.textFallbacks) {
    const parser = getTextParserInstance(provider);
    const apiKey = provider === 'openai' ? config.openaiApiKey :
                   provider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      const fallbackUsed = config.textProvider !== 'auto' && config.textProvider !== provider;
      logger.info(`[Parser Factory] Using text parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      return { parser, provider, fallbackUsed };
    }

    logger.debug(`[Parser Factory] Text parser '${provider}' unavailable: ${availability.reason}`);
  }

  // Ultimate fallback: regex parser (always available)
  logger.warn('[Parser Factory] All text parsers unavailable, using regex fallback');
  const regexParser = getRegexParser();
  return { parser: regexParser, provider: 'regex', fallbackUsed: true };
}

/**
 * Parse boarding pass with automatic provider selection and fallback on errors
 */
export async function parseBoardingPass(
  imageBase64: string,
  config: ParserConfig
): Promise<ParserResult> {
  const errors: Array<{ provider: VisionProvider; error: string }> = [];

  // Build the provider chain: preferred (if not auto) + fallbacks
  const providerChain: VisionProvider[] =
    config.visionProvider !== 'auto'
      ? [config.visionProvider, ...config.visionFallbacks.filter(p => p !== config.visionProvider)]
      : config.visionFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getVisionParserInstance(provider);
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;

      // Check availability first
      const availability = await checkProviderAvailability(parser, apiKey);
      if (!availability.available) {
        logger.debug(`[Parser Factory] Skipping unavailable vision parser: ${provider} - ${availability.reason}`);
        errors.push({ provider, error: availability.reason || 'Unavailable' });
        continue;
      }

      // Try parsing
      logger.info(`[Parser Factory] Attempting vision parse with: ${provider}`);
      const flight = await parser.parseImage(imageBase64, apiKey);

      const fallbackUsed = config.visionProvider !== 'auto' && config.visionProvider !== provider;
      logger.info(`[Parser Factory] Vision parse successful with: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);

      return {
        flights: [flight],
        provider,
        fallbackUsed,
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`[Parser Factory] Vision parser '${provider}' failed: ${errorMsg}`);
      errors.push({ provider, error: errorMsg });

      // Invalidate cache for this provider to prevent future attempts in this session
      const cacheKey = `${provider}-${config.openaiApiKey || config.claudeApiKey || 'default'}`;
      availabilityCache.delete(cacheKey);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  logger.error({ errors }, '[Parser Factory] All vision parsers failed');
  throw new Error(
    `All vision parsers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`
  );
}

/**
 * Parse email with automatic provider selection and fallback on errors
 */
export async function parseEmail(
  subject: string,
  text: string,
  html: string | undefined,
  config: ParserConfig
): Promise<ParserResult> {
  const errors: Array<{ provider: TextProvider; error: string }> = [];

  // Build the provider chain: preferred (if not auto) + fallbacks
  const providerChain: TextProvider[] =
    config.textProvider !== 'auto'
      ? [config.textProvider, ...config.textFallbacks.filter(p => p !== config.textProvider)]
      : config.textFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getTextParserInstance(provider);
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;

      // Check availability first
      const availability = await checkProviderAvailability(parser, apiKey);
      if (!availability.available) {
        logger.debug(`[Parser Factory] Skipping unavailable text parser: ${provider} - ${availability.reason}`);
        errors.push({ provider, error: availability.reason || 'Unavailable' });
        continue;
      }

      // Try parsing
      logger.info(`[Parser Factory] Attempting email parse with: ${provider}`);
      const flights = await parser.parseEmail(subject, text, html, apiKey);

      if (!flights || flights.length === 0) {
        throw new Error('Parser returned no flights');
      }

      const fallbackUsed = config.textProvider !== 'auto' && config.textProvider !== provider;
      logger.info(`[Parser Factory] Email parse successful with: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);

      return {
        flights,
        provider,
        fallbackUsed,
      };
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`[Parser Factory] Text parser '${provider}' failed: ${errorMsg}`);
      errors.push({ provider, error: errorMsg });

      // Invalidate cache for this provider to prevent future attempts in this session
      const cacheKey = `${provider}-${config.openaiApiKey || config.claudeApiKey || 'default'}`;
      availabilityCache.delete(cacheKey);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  logger.error({ errors }, '[Parser Factory] All text parsers failed');
  throw new Error(
    `All text parsers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`
  );
}

/**
 * Get all available providers (for settings UI)
 */
export async function getAvailableProviders(config: ParserConfig): Promise<{
  vision: Array<{ provider: VisionProvider; availability: ProviderAvailability }>;
  text: Array<{ provider: TextProvider; availability: ProviderAvailability }>;
}> {
  const allVisionProviders: VisionProvider[] = ['ollama', 'openai', 'claude', 'tesseract', 'manual'];
  const allTextProviders: TextProvider[] = ['ollama', 'openai', 'claude', 'regex'];

  const visionResults = await Promise.all(
    allVisionProviders.map(async (provider) => {
      const parser = getVisionParserInstance(provider);
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;
      const availability = await checkProviderAvailability(parser, apiKey);
      return { provider, availability };
    })
  );

  const textResults = await Promise.all(
    allTextProviders.map(async (provider) => {
      const parser = getTextParserInstance(provider);
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;
      const availability = await checkProviderAvailability(parser, apiKey);
      return { provider, availability };
    })
  );

  return {
    vision: visionResults,
    text: textResults,
  };
}

/**
 * Clear availability cache (useful for testing API keys)
 */
export function clearAvailabilityCache(): void {
  availabilityCache.clear();
  logger.info('[Parser Factory] Availability cache cleared');
}
