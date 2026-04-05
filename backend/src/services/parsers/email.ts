import { TextProvider, ParserConfig, ParserResult } from './types';
import { ParsedBooking } from '../bookingParser';
import logger, { parserFactoryLogger, parserTextLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { extractFlightDataFromText, cleanEmailBody } from './shared/utils';
import { getAirlineName } from '../flightLookup';
import { collectLowQualityFeedback } from '../parserFeedback';
import { checkProviderAvailability, deleteAvailabilityCacheEntry } from './config';
import { getTextParserInstance } from './providers';
import { calculateParserQuality } from './boardingPass';
import { findMatchingTemplate } from './userTemplates/matcher';
import { applyUserTemplate } from './userTemplates/engine';
import { TemplateParser } from './text/templateParser';

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

    // Derive airline name from flight number prefix if not already set
    if (!enhanced.airline && enhanced.flightNumber) {
      const iataPrefix = enhanced.flightNumber.match(/^([A-Z0-9]{2})/)?.[1];
      if (iataPrefix) {
        const name = getAirlineName(iataPrefix);
        if (name) enhanced.airline = name;
      }
    }

    return enhanced;
  });
}

/**
 * Parse email using regex/template-based parsing only
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

  // Clean the plain-text body before any parsing so parsers see the same
  // filtered content that the annotation view shows (URLs, HTML fragments removed,
  // whitespace normalised).  The From: header is extracted from the raw text first
  // so that email-address-based template detection is unaffected.
  const fromMatch = /^From:\s*(.+)$/im.exec(text);
  const fromAddress = fromMatch ? fromMatch[1].trim() : "";
  const cleanedText = cleanEmailBody(text);

  if (shouldLog) {
    log.info({
      operation: 'parse_email_start',
      context: {
        subject,
        textLength: text.length,
        cleanedTextLength: cleanedText.length,
        htmlLength: html ? html.length : 0,
        fallbackChain: config.textFallbacks,
      },
    });
  }

  // Step 0: User-derived regex templates (before HTML-selector templates)
  if (config.userId) {

    const userTemplate = await findMatchingTemplate(config.userId, fromAddress, subject, cleanedText);
    if (userTemplate) {
      const userResults = applyUserTemplate(userTemplate, subject, cleanedText);
      const bestConfidence = userResults[0]?.parserConfidence ?? 0;
      if (bestConfidence >= 80) {
        log.info(
          { templateName: userTemplate.name, flights: userResults.length, confidence: bestConfidence },
          "[Parser Factory] User-derived template matched (confidence >=80%)"
        );
        return {
          flights: userResults as ParsedBooking[],
          provider: "regex" as const,
          fallbackUsed: false,
        };
      }
    }
  }

  // Template-Parser (HTML-selector based templates)
  const templateParser = new TemplateParser();
  const templateAvail = await templateParser.checkAvailability();
  if (templateAvail.available) {
    const templateResults = await templateParser.parseEmail(subject, cleanedText, html, config.userId);
    if (templateResults.length > 0 && (templateResults[0].parserConfidence ?? 0) >= 30) {
      logger.info(
        { confidence: templateResults[0].parserConfidence, parserTemplate: templateResults[0].parserTemplate },
        '[Parser Factory] Template parser matched with sufficient confidence'
      );
      return {
        flights: templateResults,
        provider: 'regex' as const,
        fallbackUsed: false,
      };
    }
  }

  // Regex provider chain
  const providerChain: TextProvider[] = config.textFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getTextParserInstance(provider);

      // Check availability first
      const availability = await checkProviderAvailability(parser);
      if (!availability.available) {
        if (shouldLog) {
          textLog.debug({
            operation: 'text_parser_skipped',
            context: { provider, reason: availability.reason },
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
          context: { provider, textLength: cleanedText.length, htmlLength: html ? html.length : 0 },
        });
      } else {
        logger.info(`[Parser Factory] Attempting email parse with: ${provider}`);
      }

      const flights = await parser.parseEmail(subject, cleanedText, html);
      const parseDuration = Date.now() - parseStartTime;

      if (!flights || flights.length === 0) {
        throw new Error('Parser returned no flights');
      }

      const finalFlights = applyEmailRegexPostProcessing(flights, subject, cleanedText, html);
      const finalProvider = provider;
      const finalFallbackUsed = config.textProvider !== provider;

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
          undefined,
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

      // Invalidate cache for this provider
      deleteAvailabilityCacheEntry(`${provider}-default`);

      // Continue to next provider
      continue;
    }
  }

  // All providers failed
  const totalDuration = Date.now() - startTime;
  if (shouldLog) {
    log.error({
      operation: 'parse_email_failed',
      context: { errors, totalDuration, triedProviders: providerChain },
    });
  } else {
    logger.error({ errors }, '[Parser Factory] All text parsers failed');
  }
  throw new Error(
    `All text parsers failed. Errors: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`
  );
}
