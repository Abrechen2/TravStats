import {
  IVisionParser,
  ITextParser,
  VisionProvider,
  TextProvider,
  ParserConfig,
} from './types';
import logger, { parserFactoryLogger, parserVisionLogger, parserTextLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { checkProviderAvailability } from './config';

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
 * Get vision parser instance by provider
 * @param provider - Vision provider
 * @param modelName - Optional model name (for Ollama)
 */
export function getVisionParserInstance(provider: VisionProvider, modelName?: string): IVisionParser {
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
export function getTextParserInstance(provider: TextProvider, modelName?: string): ITextParser {
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
