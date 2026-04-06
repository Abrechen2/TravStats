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

// Import vision parsers
import { getTesseractParser } from './vision/tesseractParser';
import { getManualParser } from './vision/manualParser';

// Import text parsers
import { getRegexParser } from './text/regexParser';
import { getOllamaTextParser } from './text/ollamaTextParser';

/**
 * Get vision parser instance by provider
 */
export function getVisionParserInstance(provider: VisionProvider): IVisionParser {
  switch (provider) {
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
export function getTextParserInstance(provider: TextProvider, config?: ParserConfig): ITextParser {
  switch (provider) {
    case 'regex':
      return getRegexParser();
    case 'ollama':
      return getOllamaTextParser(config?.ollamaUrl, config?.ollamaModel);
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
      },
    });
  } else {
    logger.info(
      { preferred: config.visionProvider, fallbackChain: config.visionFallbacks },
      '[Parser Factory] Resolving vision parser'
    );
  }

  // Try each provider in chain
  for (const provider of config.visionFallbacks) {
    const parser = getVisionParserInstance(provider);
    const availability = await checkProviderAvailability(parser);

    if (availability.available) {
      const fallbackUsed = config.visionProvider !== provider;
      if (shouldLog) {
        visionLog.info({
          operation: 'vision_parser_selected',
          context: { provider, fallbackUsed, availability },
        });
      } else {
        logger.info(`[Parser Factory] Using vision parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }
      return { parser, provider, fallbackUsed };
    }

    if (shouldLog) {
      visionLog.debug({
        operation: 'vision_parser_skipped',
        context: { provider, reason: availability.reason },
      });
    } else {
      logger.debug(`[Parser Factory] Vision parser '${provider}' unavailable: ${availability.reason}`);
    }
  }

  // Ultimate fallback: manual parser (always available)
  if (shouldLog) {
    visionLog.warn({
      operation: 'vision_parser_fallback_manual',
      context: { triedProviders: config.visionFallbacks },
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
      },
    });
  } else {
    logger.info(
      { preferred: config.textProvider, fallbackChain: config.textFallbacks },
      '[Parser Factory] Resolving text parser'
    );
  }

  // Try each provider in chain
  for (const provider of config.textFallbacks) {
    const parser = getTextParserInstance(provider, config);
    const availability = await checkProviderAvailability(parser);

    if (availability.available) {
      const fallbackUsed = config.textProvider !== provider;
      if (shouldLog) {
        textLog.info({
          operation: 'text_parser_selected',
          context: { provider, fallbackUsed, availability },
        });
      } else {
        logger.info(`[Parser Factory] Using text parser: ${provider}${fallbackUsed ? ' (fallback)' : ''}`);
      }
      return { parser, provider, fallbackUsed };
    }

    if (shouldLog) {
      textLog.debug({
        operation: 'text_parser_skipped',
        context: { provider, reason: availability.reason },
      });
    } else {
      logger.debug(`[Parser Factory] Text parser '${provider}' unavailable: ${availability.reason}`);
    }
  }

  // Ultimate fallback: regex parser (always available)
  if (shouldLog) {
    textLog.warn({
      operation: 'text_parser_fallback_regex',
      context: { triedProviders: config.textFallbacks },
    });
  } else {
    logger.warn('[Parser Factory] All text parsers unavailable, using regex fallback');
  }
  const regexParser = getRegexParser();
  return { parser: regexParser, provider: 'regex', fallbackUsed: true };
}
