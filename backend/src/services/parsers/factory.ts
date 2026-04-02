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
import logger, { parserFactoryLogger, parserVisionLogger, parserTextLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { decryptApiKey } from '../../utils/encryption';
import { extractFlightDataFromText } from './shared/utils';
import { collectLowQualityFeedback } from '../parserFeedback';

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
import { TemplateParser } from './text/templateParser';
import { findMatchingTemplate } from './userTemplates/matcher';
import { applyUserTemplate } from './userTemplates/engine';

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
 * @param provider - Vision provider
 * @param modelName - Optional model name (for Ollama)
 */
function getVisionParserInstance(provider: VisionProvider, modelName?: string): IVisionParser {
  switch (provider) {
    case 'ollama':
      return getOllamaVisionParser(modelName);
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
 * @param provider - Text provider
 * @param modelName - Optional model name (for Ollama)
 */
function getTextParserInstance(provider: TextProvider, modelName?: string): ITextParser {
  switch (provider) {
    case 'ollama':
      return getOllamaTextParser(modelName);
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
    ollamaUrl: process.env.OLLAMA_URL,
    ollamaModel: selectedEmailModel,
    ollamaVisionModel: selectedVisionModel,
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
 * Get vision parser with fallback support
 */
export async function getVisionParser(
  config: ParserConfig
): Promise<{ parser: IVisionParser; provider: VisionProvider; fallbackUsed: boolean }> {
  const shouldLog = await shouldLogParserOperations();
  const log = shouldLog ? parserFactoryLogger : logger;
  const visionLog = shouldLog ? parserVisionLogger : logger;

  if (shouldLog) {
    log.info({
      operation: 'get_vision_parser_start',
      context: {
        preferred: config.visionProvider,
        fallbackChain: config.visionFallbacks,
        mode: config.visionProvider === 'auto' ? 'auto' : 'manual',
      },
    });
  } else {
    logger.info(
      {
        preferred: config.visionProvider,
        fallbackChain: config.visionFallbacks,
      },
      '[Parser Factory] Resolving vision parser'
    );
  }

  // If specific provider requested (not auto)
  if (config.visionProvider !== 'auto') {
    const parser = getVisionParserInstance(
      config.visionProvider,
      config.visionProvider === 'ollama' ? config.ollamaVisionModel : undefined
    );
    const apiKey = config.visionProvider === 'openai' ? config.openaiApiKey :
                   config.visionProvider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parser_selected',
          context: {
            provider: config.visionProvider,
            fallbackUsed: false,
            availability,
          },
        });
      } else {
        logger.info(`[Parser Factory] Using requested vision parser: ${config.visionProvider}`);
      }
      return { parser, provider: config.visionProvider, fallbackUsed: false };
    }

    if (shouldLog) {
      visionLog.warn({
        operation: 'vision_parser_unavailable',
        context: {
          provider: config.visionProvider,
          reason: availability.reason,
          availability,
        },
      });
    } else {
      logger.warn(`[Parser Factory] Requested vision parser '${config.visionProvider}' unavailable: ${availability.reason}`);
    }
  }

  // Auto mode or fallback: try each provider in chain
  for (const provider of config.visionFallbacks) {
    const parser = getVisionParserInstance(
      provider,
      provider === 'ollama' ? config.ollamaVisionModel : undefined
    );
    const apiKey = provider === 'openai' ? config.openaiApiKey :
                   provider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      const fallbackUsed = config.visionProvider !== 'auto' && config.visionProvider !== provider;
      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parser_selected',
          context: {
            provider,
            fallbackUsed,
            availability,
            requestedProvider: config.visionProvider,
          },
        });
      } else {
        logger.info(`[Parser Factory] Using vision parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }
      return { parser, provider, fallbackUsed };
    }

    if (shouldLog) {
      visionLog.debug({
        operation: 'vision_parser_skipped',
        context: {
          provider,
          reason: availability.reason,
          availability,
        },
      });
    } else {
      logger.debug(`[Parser Factory] Vision parser '${provider}' unavailable: ${availability.reason}`);
    }
  }

  // Ultimate fallback: manual parser (always available)
  if (shouldLog) {
    visionLog.warn({
      operation: 'vision_parser_fallback_manual',
      context: {
        requestedProvider: config.visionProvider,
        triedProviders: config.visionFallbacks,
      },
    });
  } else {
    logger.warn('[Parser Factory] All vision parsers unavailable, using manual fallback');
  }
  const manualParser = getManualParser();
  return { parser: manualParser, provider: 'manual', fallbackUsed: true };
}

/**
 * Get text parser with fallback support
 */
export async function getTextParser(
  config: ParserConfig
): Promise<{ parser: ITextParser; provider: TextProvider; fallbackUsed: boolean }> {
  const shouldLog = await shouldLogParserOperations();
  const log = shouldLog ? parserFactoryLogger : logger;
  const textLog = shouldLog ? parserTextLogger : logger;

  if (shouldLog) {
    log.info({
      operation: 'get_text_parser_start',
      context: {
        preferred: config.textProvider,
        fallbackChain: config.textFallbacks,
        mode: config.textProvider === 'auto' ? 'auto' : 'manual',
      },
    });
  } else {
    logger.info(
      {
        preferred: config.textProvider,
        fallbackChain: config.textFallbacks,
      },
      '[Parser Factory] Resolving text parser'
    );
  }

  // If specific provider requested (not auto)
  if (config.textProvider !== 'auto') {
    const parser = getTextParserInstance(
      config.textProvider,
      config.textProvider === 'ollama' ? config.ollamaModel : undefined
    );
    const apiKey = config.textProvider === 'openai' ? config.openaiApiKey :
                   config.textProvider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      if (shouldLog) {
        textLog.info({
          operation: 'text_parser_selected',
          context: {
            provider: config.textProvider,
            fallbackUsed: false,
            availability,
          },
        });
      } else {
        logger.info(`[Parser Factory] Using requested text parser: ${config.textProvider}`);
      }
      return { parser, provider: config.textProvider, fallbackUsed: false };
    }

    if (shouldLog) {
      textLog.warn({
        operation: 'text_parser_unavailable',
        context: {
          provider: config.textProvider,
          reason: availability.reason,
          availability,
        },
      });
    } else {
      logger.warn(`[Parser Factory] Requested text parser '${config.textProvider}' unavailable: ${availability.reason}`);
    }
  }

  // Auto mode or fallback: try each provider in chain
  for (const provider of config.textFallbacks) {
    const parser = getTextParserInstance(
      provider,
      provider === 'ollama' ? config.ollamaModel : undefined
    );
    const apiKey = provider === 'openai' ? config.openaiApiKey :
                   provider === 'claude' ? config.claudeApiKey : undefined;

    const availability = await checkProviderAvailability(parser, apiKey);

    if (availability.available) {
      const fallbackUsed = config.textProvider !== 'auto' && config.textProvider !== provider;
      if (shouldLog) {
        textLog.info({
          operation: 'text_parser_selected',
          context: {
            provider,
            fallbackUsed,
            availability,
            requestedProvider: config.textProvider,
          },
        });
      } else {
        logger.info(`[Parser Factory] Using text parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }
      return { parser, provider, fallbackUsed };
    }

    if (shouldLog) {
      textLog.debug({
        operation: 'text_parser_skipped',
        context: {
          provider,
          reason: availability.reason,
          availability,
        },
      });
    } else {
      logger.debug(`[Parser Factory] Text parser '${provider}' unavailable: ${availability.reason}`);
    }
  }

  // Ultimate fallback: regex parser (always available)
  if (shouldLog) {
    textLog.warn({
      operation: 'text_parser_fallback_regex',
      context: {
        requestedProvider: config.textProvider,
        triedProviders: config.textFallbacks,
      },
    });
  } else {
    logger.warn('[Parser Factory] All text parsers unavailable, using regex fallback');
  }
  const regexParser = getRegexParser();
  return { parser: regexParser, provider: 'regex', fallbackUsed: true };
}

/**
 * Calculate quality score for parsed booking (0-100)
 * Higher score = better quality
 */
function calculateParserQuality(flights: ParsedBooking[]): number {
  if (flights.length === 0) return 0;

  let totalScore = 0;
  for (const flight of flights) {
    let score = 0;
    const maxScore = 100;

    // Critical fields (40 points total)
    if (flight.flightNumber) score += 10;
    if (flight.departureCode) score += 10;
    if (flight.arrivalCode) score += 10;
    if (flight.departureTime) score += 10;

    // Important fields (30 points total)
    if (flight.arrivalTime) score += 10;
    if (flight.pnr || flight.bookingReference) score += 10;
    if (flight.seat) score += 5;
    if (flight.gate) score += 5;

    // Optional fields (30 points total)
    if (flight.airline) score += 5;
    if (flight.terminal) score += 5;
    if (flight.seatClass) score += 5;
    if (flight.aircraft) score += 5;
    if (flight.price) score += 5;
    if (flight.ticketNumber) score += 5;

    // Penalty for missing critical fields
    const criticalMissing = ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime']
      .filter(f => flight.missing.includes(f)).length;
    score -= criticalMissing * 10;

    totalScore += Math.max(0, Math.min(100, score));
  }

  return Math.round(totalScore / flights.length);
}

/**
 * Check if result quality is too low and should trigger LLM fallback
 */
function shouldUseLLMFallback(
  flights: ParsedBooking[],
  provider: TextProvider,
  qualityThreshold: number = 40
): boolean {
  // Only check for regex parser (low quality expected)
  if (provider !== 'regex') return false;

  const quality = calculateParserQuality(flights);
  logger.debug(
    { quality, threshold: qualityThreshold, provider },
    '[Parser Factory] Quality check for LLM fallback'
  );

  return quality < qualityThreshold;
}

function isSuspiciousBoardingPassResult(flight: ParsedBooking): boolean {
  const criticalFields = ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime'];
  const missingCritical = criticalFields.filter((field) => flight.missing.includes(field)).length;

  return missingCritical >= 2 || !flight.flightNumber || flight.missing.length >= 3;
}

function applyEmailRegexPostProcessing(
  flights: ParsedBooking[],
  subject: string,
  text: string,
  html?: string
): ParsedBooking[] {
  const combinedText = `${subject}\n${text || ''}\n${html || ''}`;
  const regexData = extractFlightDataFromText(combinedText.toUpperCase());

  return flights.map((flight) => {
    const enhanced = { ...flight };

    if (!enhanced.pnr && regexData.pnr) {
      enhanced.pnr = regexData.pnr;
      enhanced.bookingReference = regexData.pnr;
    }

    if (!enhanced.gate && regexData.gate) {
      enhanced.gate = regexData.gate;
    }

    if (!enhanced.terminal && regexData.terminal) {
      enhanced.terminal = regexData.terminal;
    }

    if (flights.length === 1 && !enhanced.seat && regexData.seat) {
      enhanced.seat = regexData.seat;
    }

    return enhanced;
  });
}

/**
 * Parse boarding pass with automatic provider selection and fallback on errors
 */
export async function parseBoardingPass(
  imageBase64: string,
  config: ParserConfig
): Promise<ParserResult> {
  const errors: Array<{ provider: VisionProvider; error: string }> = [];
  const shouldLog = await shouldLogParserOperations();
  const log = shouldLog ? parserFactoryLogger : logger;
  const visionLog = shouldLog ? parserVisionLogger : logger;
  const startTime = Date.now();

  if (shouldLog) {
    log.info({
      operation: 'parse_boarding_pass_start',
      context: {
        imageSize: imageBase64.length,
        requestedProvider: config.visionProvider,
        fallbackChain: config.visionFallbacks,
      },
    });
  }

  // Build the provider chain: preferred (if not auto) + fallbacks
  const providerChain: VisionProvider[] =
    config.visionProvider !== 'auto'
      ? [config.visionProvider, ...config.visionFallbacks.filter(p => p !== config.visionProvider)]
      : config.visionFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getVisionParserInstance(
        provider,
        provider === 'ollama' ? config.ollamaVisionModel : undefined
      );
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;

      // Check availability first
      const availability = await checkProviderAvailability(parser, apiKey);
      if (!availability.available) {
        if (shouldLog) {
          visionLog.debug({
            operation: 'vision_parser_skipped',
            context: {
              provider,
              reason: availability.reason,
              availability,
            },
          });
        } else {
          logger.debug(`[Parser Factory] Skipping unavailable vision parser: ${provider} - ${availability.reason}`);
        }
        errors.push({ provider, error: availability.reason || 'Unavailable' });
        continue;
      }

      // Try parsing
      const parseStartTime = Date.now();
      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parse_attempt',
          context: {
            provider,
            imageSize: imageBase64.length,
            availability,
          },
        });
      } else {
        logger.info(`[Parser Factory] Attempting vision parse with: ${provider}`);
      }

      const flight = await parser.parseImage(imageBase64, apiKey);
      const parseDuration = Date.now() - parseStartTime;

      const fallbackUsed = config.visionProvider !== 'auto' && config.visionProvider !== provider;

      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parse_success',
          context: {
            provider,
            fallbackUsed,
            parseDuration,
            flightNumber: flight.flightNumber,
            route: `${flight.departureCode} → ${flight.arrivalCode}`,
            missingFields: flight.missing.length,
            quality: calculateParserQuality([flight]),
          },
        });
      } else {
        logger.info(`[Parser Factory] Vision parse successful with: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }

      let finalFlight = flight;
      let finalProvider: VisionProvider = provider;
      let finalFallbackUsed = fallbackUsed;

      if (provider !== 'tesseract' && isSuspiciousBoardingPassResult(flight)) {
        if (shouldLog) {
          visionLog.warn({
            operation: 'vision_result_suspicious',
            context: {
              provider,
              missingFields: flight.missing,
              quality: calculateParserQuality([flight]),
            },
          });
        } else {
          logger.warn(
            {
              missingFields: flight.missing,
              provider,
            },
            '[Parser Factory] Suspicious vision result detected, attempting Tesseract fallback'
          );
        }

        try {
          const tesseractParser = getVisionParserInstance('tesseract', undefined);
          const availability = await checkProviderAvailability(tesseractParser);

          if (availability.available) {
            const tesseractStartTime = Date.now();
            const tesseractFlight = await tesseractParser.parseImage(imageBase64);
            const tesseractDuration = Date.now() - tesseractStartTime;

            if (shouldLog) {
              visionLog.info({
                operation: 'tesseract_fallback_completed',
                context: {
                  originalMissing: flight.missing.length,
                  tesseractMissing: tesseractFlight.missing.length,
                  tesseractDuration,
                  improved: tesseractFlight.missing.length < finalFlight.missing.length,
                },
              });
            } else {
              logger.info(
                {
                  missingFields: tesseractFlight.missing,
                },
                '[Parser Factory] Tesseract fallback completed'
              );
            }

            if (tesseractFlight.missing.length < finalFlight.missing.length) {
              finalFlight = tesseractFlight;
              finalProvider = 'tesseract';
              finalFallbackUsed = true;
            }
          } else {
            if (shouldLog) {
              visionLog.debug({
                operation: 'tesseract_unavailable',
                context: {
                  reason: availability.reason,
                },
              });
            } else {
              logger.debug('[Parser Factory] Tesseract unavailable for fallback');
            }
          }
        } catch (fallbackError) {
          if (shouldLog) {
            visionLog.warn({
              operation: 'tesseract_fallback_failed',
              context: {
                error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error',
              },
            });
          } else {
            logger.warn({ fallbackError }, '[Parser Factory] Tesseract fallback failed');
          }
        }
      }

      const totalDuration = Date.now() - startTime;
      if (shouldLog) {
        log.info({
          operation: 'parse_boarding_pass_complete',
          context: {
            provider: finalProvider,
            fallbackUsed: finalFallbackUsed,
            totalDuration,
            quality: calculateParserQuality([finalFlight]),
            missingFields: finalFlight.missing.length,
          },
        });
      }

      return {
        flights: [finalFlight],
        provider: finalProvider,
        fallbackUsed: finalFallbackUsed,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (shouldLog) {
        visionLog.warn({
          operation: 'vision_parse_failed',
          context: {
            provider,
            error: errorMsg,
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      } else {
        logger.warn(`[Parser Factory] Vision parser '${provider}' failed: ${errorMsg}`);
      }
      errors.push({ provider, error: errorMsg });

      // Invalidate cache for this provider to prevent future attempts in this session
      const cacheKey = `${provider}-${config.openaiApiKey || config.claudeApiKey || 'default'}`;
      availabilityCache.delete(cacheKey);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  const totalDuration = Date.now() - startTime;
  if (shouldLog) {
    log.error({
      operation: 'parse_boarding_pass_failed',
      context: {
        errors,
        totalDuration,
        triedProviders: providerChain,
      },
    });
  } else {
    logger.error({ errors }, '[Parser Factory] All vision parsers failed');
  }
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
  const shouldLog = await shouldLogParserOperations();
  const log = shouldLog ? parserFactoryLogger : logger;
  const textLog = shouldLog ? parserTextLogger : logger;
  const startTime = Date.now();

  if (shouldLog) {
    log.info({
      operation: 'parse_email_start',
      context: {
        subject,
        textLength: text.length,
        htmlLength: html ? html.length : 0,
        requestedProvider: config.textProvider,
        fallbackChain: config.textFallbacks,
      },
    });
  }

  // Step 0: User-derived regex templates (before HTML-selector templates)
  if (config.userId) {
    const fromMatch = /^From:\s*(.+)$/im.exec(text);
    const fromAddress = fromMatch ? fromMatch[1].trim() : "";

    const userTemplate = await findMatchingTemplate(config.userId, fromAddress, subject, text);
    if (userTemplate) {
      const userResults = applyUserTemplate(userTemplate, subject, text);
      const bestConfidence = userResults[0]?.parserConfidence ?? 0;
      if (bestConfidence >= 80) {
        log.info(
          { templateName: userTemplate.name, flights: userResults.length, confidence: bestConfidence },
          "[Parser Factory] User-derived template matched (confidence >=80%), skipping LLM chain"
        );
        return {
          flights: userResults as ParsedBooking[],
          provider: "regex" as const,
          fallbackUsed: false,
        };
      }
    }
  }
  // End step 0 — fall through to HTML-selector templates

  // Template-Parser first (before LLM chain)
  const templateParser = new TemplateParser();
  const templateAvail = await templateParser.checkAvailability();
  if (templateAvail.available) {
    const templateResults = await templateParser.parseEmail(subject, text, html, config.userId);
    if (templateResults.length > 0 && (templateResults[0].parserConfidence ?? 0) >= 30) {
      logger.info(
        { confidence: templateResults[0].parserConfidence, parserTemplate: templateResults[0].parserTemplate },
        '[Parser Factory] Template parser matched with sufficient confidence, skipping LLM chain'
      );
      return {
        flights: templateResults,
        provider: 'regex' as const, // "template" is not in TextProvider union — map to nearest
        fallbackUsed: false,
      };
    }
  }
  // End template block — LLM chain follows

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
        if (shouldLog) {
          textLog.debug({
            operation: 'text_parser_skipped',
            context: {
              provider,
              reason: availability.reason,
              availability,
            },
          });
        } else {
          logger.debug(`[Parser Factory] Skipping unavailable text parser: ${provider} - ${availability.reason}`);
        }
        errors.push({ provider, error: availability.reason || 'Unavailable' });
        continue;
      }

      // Try parsing
      const parseStartTime = Date.now();
      if (shouldLog) {
        textLog.info({
          operation: 'text_parse_attempt',
          context: {
            provider,
            textLength: text.length,
            htmlLength: html ? html.length : 0,
            availability,
          },
        });
      } else {
        logger.info(`[Parser Factory] Attempting email parse with: ${provider}`);
      }

      const flights = await parser.parseEmail(subject, text, html, apiKey);
      const parseDuration = Date.now() - parseStartTime;

      if (!flights || flights.length === 0) {
        throw new Error('Parser returned no flights');
      }

      const enhancedFlights = applyEmailRegexPostProcessing(flights, subject, text, html);

      // Check quality and auto-fallback to LLM if regex quality is too low
      let finalFlights = enhancedFlights;
      let finalProvider = provider;
      let finalFallbackUsed = config.textProvider !== 'auto' && config.textProvider !== provider;

      if (shouldUseLLMFallback(enhancedFlights, provider, 40)) {
        const regexQuality = calculateParserQuality(enhancedFlights);
        if (shouldLog) {
          textLog.warn({
            operation: 'text_parse_quality_low',
            context: {
              provider,
              quality: regexQuality,
              threshold: 40,
              flightCount: enhancedFlights.length,
            },
          });
        } else {
          logger.warn(
            {
              quality: regexQuality,
              provider,
            },
            '[Parser Factory] Regex parser quality too low, attempting LLM fallback'
          );
        }

        // Try LLM parsers in order (skip regex)
        const llmProviders: TextProvider[] = ['openai', 'claude', 'ollama'];
        for (const llmProvider of llmProviders) {
          try {
            const llmParser = getTextParserInstance(
              llmProvider,
              llmProvider === 'ollama' ? config.ollamaModel : undefined
            );
            const llmApiKey = llmProvider === 'openai' ? config.openaiApiKey :
                             llmProvider === 'claude' ? config.claudeApiKey : undefined;

            const llmAvailability = await checkProviderAvailability(llmParser, llmApiKey);
            if (!llmAvailability.available) {
              if (shouldLog) {
                textLog.debug({
                  operation: 'llm_fallback_unavailable',
                  context: {
                    llmProvider,
                    reason: llmAvailability.reason,
                  },
                });
              } else {
                logger.debug(`[Parser Factory] LLM provider ${llmProvider} unavailable for quality fallback`);
              }
              continue;
            }

            if (shouldLog) {
              textLog.info({
                operation: 'llm_fallback_attempt',
                context: {
                  llmProvider,
                  originalProvider: provider,
                  originalQuality: regexQuality,
                },
              });
            } else {
              logger.info(`[Parser Factory] Attempting LLM quality fallback with: ${llmProvider}`);
            }

            const llmStartTime = Date.now();
            const llmFlights = await llmParser.parseEmail(subject, text, html, llmApiKey);
            const llmDuration = Date.now() - llmStartTime;

            if (llmFlights && llmFlights.length > 0) {
              const llmQuality = calculateParserQuality(llmFlights);

              if (llmQuality > regexQuality) {
                if (shouldLog) {
                  textLog.info({
                    operation: 'llm_fallback_success',
                    context: {
                      llmProvider,
                      originalProvider: provider,
                      regexQuality,
                      llmQuality,
                      improvement: llmQuality - regexQuality,
                      llmDuration,
                    },
                  });
                } else {
                  logger.info(
                    {
                      regexQuality,
                      llmQuality,
                      llmProvider,
                    },
                    '[Parser Factory] LLM fallback successful, using LLM result'
                  );
                }
                finalFlights = applyEmailRegexPostProcessing(llmFlights, subject, text, html);
                finalProvider = llmProvider;
                finalFallbackUsed = true;
                break;
              } else {
                if (shouldLog) {
                  textLog.debug({
                    operation: 'llm_fallback_no_improvement',
                    context: {
                      llmProvider,
                      regexQuality,
                      llmQuality,
                      llmDuration,
                    },
                  });
                } else {
                  logger.debug(
                    {
                      regexQuality,
                      llmQuality,
                    },
                    '[Parser Factory] LLM quality not better, keeping regex result'
                  );
                }
              }
            }
          } catch (llmError) {
            if (shouldLog) {
              textLog.warn({
                operation: 'llm_fallback_failed',
                context: {
                  llmProvider,
                  error: llmError instanceof Error ? llmError.message : 'Unknown error',
                },
              });
            } else {
              logger.warn(
                { error: llmError, llmProvider },
                '[Parser Factory] LLM quality fallback failed, keeping regex result'
              );
            }
            // Continue to next LLM provider or keep regex result
          }
        }
      }

      const finalQuality = calculateParserQuality(finalFlights);
      const totalDuration = Date.now() - startTime;

      if (shouldLog) {
        log.info({
          operation: 'parse_email_complete',
          context: {
            provider: finalProvider,
            fallbackUsed: finalFallbackUsed,
            quality: finalQuality,
            flightCount: finalFlights.length,
            totalDuration,
            parseDuration,
          },
        });
      } else {
        logger.info(
          {
            provider: finalProvider,
            fallbackUsed: finalFallbackUsed,
            quality: finalQuality,
            flightCount: finalFlights.length,
          },
          `[Parser Factory] Email parse complete with: ${finalProvider}${finalFallbackUsed ? ' (fallback)' : ''}`
        );
      }

      // Collect feedback for low-quality results (async, don't await)
      if (finalQuality < 50) {
        collectLowQualityFeedback(
          undefined, // userId - could be passed from route if available
          'email',
          finalProvider,
          finalFlights,
          { subject, text, html }
        ).catch(err => logger.warn({ error: err }, '[Parser Factory] Failed to collect feedback'));
      }

      return {
        flights: finalFlights,
        provider: finalProvider,
        fallbackUsed: finalFallbackUsed,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      if (shouldLog) {
        textLog.warn({
          operation: 'text_parse_failed',
          context: {
            provider,
            error: errorMsg,
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      } else {
        logger.warn(`[Parser Factory] Text parser '${provider}' failed: ${errorMsg}`);
      }
      errors.push({ provider, error: errorMsg });

      // Invalidate cache for this provider to prevent future attempts in this session
      const cacheKey = `${provider}-${config.openaiApiKey || config.claudeApiKey || 'default'}`;
      availabilityCache.delete(cacheKey);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  const totalDuration = Date.now() - startTime;
  if (shouldLog) {
    log.error({
      operation: 'parse_email_failed',
      context: {
        errors,
        totalDuration,
        triedProviders: providerChain,
      },
    });
  } else {
    logger.error({ errors }, '[Parser Factory] All text parsers failed');
  }
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
      const parser = getVisionParserInstance(
        provider,
        provider === 'ollama' ? config.ollamaVisionModel : undefined
      );
      const apiKey = provider === 'openai' ? config.openaiApiKey :
                     provider === 'claude' ? config.claudeApiKey : undefined;
      const availability = await checkProviderAvailability(parser, apiKey);
      return { provider, availability };
    })
  );

  const textResults = await Promise.all(
    allTextProviders.map(async (provider) => {
      const parser = getTextParserInstance(
        provider,
        provider === 'ollama' ? config.ollamaModel : undefined
      );
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
