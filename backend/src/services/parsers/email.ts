import { TextProvider, ParserConfig, ParserResult } from './types';
import { ParsedBooking } from '../bookingParser';
import logger, { parserFactoryLogger, parserTextLogger } from '../../utils/logger';
import { shouldLogParserOperations } from '../loggingConfig';
import { extractFlightDataFromText } from './shared/utils';
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

    return enhanced;
  });
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
      deleteAvailabilityCacheEntry(cacheKey);

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
