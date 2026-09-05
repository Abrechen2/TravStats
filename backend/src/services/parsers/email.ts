import { TextProvider, ParserConfig, ParserResult } from './types';
import { keepOnlyFlightsWithEvidence } from './shared/evidence';
import { backfillRoutesFromText } from './shared/routeFromText';
import { preferNamedAirports } from './shared/namedAirport';
import { airportsInCityOf } from '../airportLookup';
import { ParsedBooking } from '../bookingParser';
import logger, { parserFactoryLogger, parserTextLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { extractFlightDataFromText, cleanEmailBody } from './shared/utils';
import { getAirlineName } from '../flightLookup';
import { checkProviderAvailability, deleteAvailabilityCacheEntry } from './config';
import { getTextParserInstance } from './providers';
import { calculateParserQuality } from './boardingPass';
import { findMatchingTemplate } from './userTemplates/matcher';
import { applyUserTemplate } from './userTemplates/engine';
import { TemplateParser } from './text/templateParser';

async function applyEmailRegexPostProcessing(
  flights: ParsedBooking[],
  subject: string,
  text: string,
  html?: string
): Promise<ParsedBooking[]> {
  const combinedText = `${subject}\n${text || ''}\n${html || ''}`;
  const regexData = extractFlightDataFromText(combinedText.toUpperCase());

  const withFields = flights.map((flight) => {
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

    // Derive marketing airline name from flight number prefix if not already set
    if (!enhanced.airline && enhanced.flightNumber) {
      const iataPrefix = enhanced.flightNumber.match(/^([A-Z0-9]{2})/)?.[1];
      if (iataPrefix) {
        const name = getAirlineName(iataPrefix);
        if (name) enhanced.airline = name;
      }
    }

    // Extract operating carrier from "operated by X" / "durchgeführt von X" patterns
    if (!enhanced.operatingAirline) {
      const operatedByPattern = /(?:operated\s+by|durchgeführt\s+von|betrieb(?:en)?\s+von|Durchführender\s+Carrier|operating\s+carrier)[:\s]+([^\n,;]{2,50})/i;
      const opMatch = operatedByPattern.exec(combinedText);
      if (opMatch) {
        const opName = opMatch[1].trim();
        // Only set if different from marketing airline
        if (opName && opName.toLowerCase() !== (enhanced.airline ?? "").toLowerCase()) {
          enhanced.operatingAirline = opName;
        }
      }
    }

    return enhanced;
  });

  // The route is recovered across the whole document rather than per flight,
  // because pairing the bracketed codes needs the itinerary in order. Note this
  // passes combinedText in its ORIGINAL case: the uppercased copy above would
  // turn an ordinary "(die)" into a code and reintroduce the false positives
  // the bracket rule exists to avoid.
  const routed = backfillRoutesFromText(withFields, combinedText);
  // Then the name check (#287): a model told to answer in codes answers the
  // CITY's code, and "Berlin-Schönefeld" in a 2008 mail becomes the airport
  // that opened in 2020. The catalogue knows the name; the text wins.
  return preferNamedAirports(routed, combinedText, airportsInCityOf);
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

  /**
   * A provider that ran to completion and found no booking, if one did.
   *
   * Kept apart from `errors` because the two mean opposite things: an entry in
   * `errors` is a provider that could not do its job, while this is a provider
   * that did it and answered "there is no flight in this mail". Only the first
   * kind justifies failing the request — see the tail of this function.
   */
  let parsedWithoutFlights: TextProvider | null = null;
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
          flights: keepOnlyFlightsWithEvidence(userResults as ParsedBooking[], "regex"),
          provider: "regex" as const,
          fallbackUsed: false,
        };
      }
    }
  }

  // Determine if Ollama should be tried before templates
  // When Ollama is explicitly configured (ollamaUrl set), it takes priority over templates.
  // Templates become the fallback when Ollama is unavailable or returns no results.
  const ollamaConfigured = !!config.ollamaUrl && config.textFallbacks.includes('ollama');

  if (ollamaConfigured) {
    // Try Ollama first (before templates) when explicitly configured
    try {
      const ollamaParser = getTextParserInstance('ollama', config);
      const ollamaAvail = await checkProviderAvailability(ollamaParser);
      if (ollamaAvail.available) {
        logger.info('[Parser Factory] Ollama configured — trying LLM before templates');
        const ollamaFlights = await ollamaParser.parseEmail(
          subject,
          cleanedText,
          html,
          undefined,
          { referenceDate: config.referenceDate },
        );
        if (ollamaFlights && ollamaFlights.length > 0) {
          const finalFlights = await applyEmailRegexPostProcessing(ollamaFlights, subject, cleanedText, html);
          logger.info({ flightCount: finalFlights.length }, '[Parser Factory] Ollama succeeded — skipping templates');
          return {
            flights: keepOnlyFlightsWithEvidence(finalFlights, "ollama"),
            provider: 'ollama' as const,
            fallbackUsed: false,
          };
        }
        parsedWithoutFlights = 'ollama';
        logger.info('[Parser Factory] Ollama returned no flights — falling back to templates');
      } else {
        logger.info(`[Parser Factory] Ollama unavailable (${ollamaAvail.reason}) — falling back to templates`);
      }
    } catch (err) {
      logger.warn(`[Parser Factory] Ollama failed — falling back to templates: ${err instanceof Error ? err.message : String(err)}`);
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
        flights: keepOnlyFlightsWithEvidence(templateResults, "regex"),
        provider: 'regex' as const,
        fallbackUsed: false,
      };
    }
  }

  // Regex provider chain (ollama already tried above if configured, skip it here)
  const providerChain: TextProvider[] = ollamaConfigured
    ? config.textFallbacks.filter((p) => p !== 'ollama')
    : config.textFallbacks;

  // Try each provider in order
  for (const provider of providerChain) {
    try {
      const parser = getTextParserInstance(provider, config);

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

      const flights = await parser.parseEmail(subject, cleanedText, html, undefined, {
        referenceDate: config.referenceDate,
      });
      const parseDuration = Date.now() - parseStartTime;

      if (!flights || flights.length === 0) {
        // Finding no booking is an ANSWER, not a failure. Throwing here put the
        // provider in `errors`, and once the chain was exhausted the caller was
        // told every parser had failed — HTTP 500 for a marketing mail that
        // simply contains no flight (Forgejo #35). Carry on to the next
        // provider; the tail decides what an empty result means.
        parsedWithoutFlights = provider;
        continue;
      }

      const finalFlights = await applyEmailRegexPostProcessing(flights, subject, cleanedText, html);
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

      return {
        flights: keepOnlyFlightsWithEvidence(finalFlights, finalProvider),
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

  // A provider read the mail and found nothing in it. That is a result, and the
  // route renders it as an empty list; the import modal then says "no flight
  // found" instead of "email parsing failed". Only a chain in which nothing ran
  // reaches the throw below.
  if (parsedWithoutFlights) {
    return {
      flights: [],
      provider: parsedWithoutFlights,
      fallbackUsed: config.textProvider !== parsedWithoutFlights,
    };
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
