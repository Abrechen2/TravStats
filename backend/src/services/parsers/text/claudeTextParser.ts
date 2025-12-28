import Anthropic from '@anthropic-ai/sdk';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getTextParserPrompt, getLatestClaudeTextModel, getClaudeTextModels } from '../shared/utils';
import logger, { parserTextLogger } from '../../../utils/logger';
import { shouldLogParserOperations } from '../../loggingConfig';

/**
 * Get Claude model - uses env var if set, otherwise latest available model
 */
function getClaudeModel(): string {
  return getLatestClaudeTextModel();
}

/**
 * Claude 3.5 Sonnet Text Parser
 *
 * Uses Anthropic's Claude 3.5 Sonnet for email parsing.
 *
 * Pros:
 * - Excellent accuracy for structured data
 * - Good multilingual support
 * - Handles complex emails well
 *
 * Cons:
 * - Requires API key and credits
 * - Cost: ~$0.003-0.015 per email
 * - Data sent to Anthropic servers
 */
export class ClaudeTextParser implements ITextParser {
  readonly provider: TextProvider = 'claude';
  private client: Anthropic | null = null;

  private getClient(apiKey?: string): Anthropic {
    const key = apiKey || process.env.CLAUDE_API_KEY;

    if (!key) {
      throw new Error('Claude API key not configured');
    }

    // Reset client if API key changed
    if (!this.client || (apiKey && this.client.apiKey !== key)) {
      this.client = new Anthropic({ apiKey: key });
    }

    return this.client;
  }

  /**
   * Reset client instance (useful when API key changes)
   */
  resetClient(): void {
    this.client = null;
  }

  async checkAvailability(apiKey?: string): Promise<ProviderAvailability> {
    try {
      const key = apiKey || process.env.CLAUDE_API_KEY;

      if (!key) {
        return {
          available: false,
          reason: 'Claude API key not configured',
        };
      }

      // Verify key format
      if (!/^sk-ant-/.test(key)) {
        return {
          available: false,
          reason: 'Invalid Claude API key format',
        };
      }

      return {
        available: true,
        metadata: {
          provider: 'claude',
          model: getClaudeModel(),
          cost: '~$0.003-0.015 per email',
        },
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseEmail(subject: string, text: string, html?: string, apiKey?: string): Promise<ParsedBooking[]> {
    const shouldLog = await shouldLogParserOperations();
    const log = shouldLog ? parserTextLogger : logger;
    const startTime = Date.now();

    const modelsToTry = getClaudeTextModels();
    const client = this.getClient(apiKey);
    const prompt = getTextParserPrompt(subject, text);
    
    let lastError: any = null;
    
    // Try each model in order until one works
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      const isFirstAttempt = i === 0;
      const isLastAttempt = i === modelsToTry.length - 1;
      
      if (shouldLog) {
        log.info({
          operation: isFirstAttempt ? 'claude_text_parse_start' : 'claude_text_parse_retry',
          context: {
            model,
            attempt: i + 1,
            totalModels: modelsToTry.length,
            subject,
            textLength: text.length,
            htmlLength: html ? html.length : 0,
            previousError: lastError ? (lastError instanceof Error ? lastError.message : 'Unknown error') : undefined,
          },
        });
      } else {
        if (isFirstAttempt) {
          logger.info('[Claude Text Parser] Starting email parsing');
        } else {
          logger.info({ model, attempt: i + 1 }, '[Claude Text Parser] Retrying with different model');
        }
        logger.info({ model }, '[Claude Text Parser] Model');
      }

      try {
        const apiStartTime = Date.now();
        const response = await client.messages.create({
          model,
          max_tokens: 2048,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });
      const apiDuration = Date.now() - apiStartTime;

      const rawResponse = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const totalTokens = inputTokens + outputTokens;

      if (!rawResponse) {
        if (shouldLog) {
          log.error({
            operation: 'claude_text_parse_empty_response',
            context: {
              apiDuration,
              inputTokens,
            },
          });
        } else {
          logger.error('[Claude Text Parser] Empty response');
        }
        throw new Error('Empty response from Claude API');
      }

      if (shouldLog) {
        log.debug({
          operation: 'claude_text_parse_raw_response',
          context: {
            rawResponseLength: rawResponse.length,
            inputTokens,
            outputTokens,
            totalTokens,
            apiDuration,
          },
        });
      } else {
        logger.debug({ rawResponse }, '[Claude Text Parser] Raw response (full)');
      }

      // Parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);
      let parsedData: any;

      try {
        parsedData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        if (shouldLog) {
          log.error({
            operation: 'claude_text_parse_json_error',
            context: {
              rawResponseLength: rawResponse.length,
              cleanedResponseLength: cleanedResponse.length,
              error: parseError instanceof Error ? parseError.message : 'Unknown error',
            },
          });
        } else {
          logger.error({ response: rawResponse }, '[Claude Text Parser] JSON parse error');
        }
        throw new Error('Failed to parse Claude response as JSON');
      }

      // Normalize to array
      let flightsArray: any[] = [];

      if (Array.isArray(parsedData)) {
        flightsArray = parsedData;
      } else if (parsedData && typeof parsedData === 'object') {
        const possibleKeys = ['flights', 'flightNumbers', 'data', 'results', 'items'];
        let foundArray = false;

        for (const key of possibleKeys) {
          if (Array.isArray(parsedData[key])) {
            flightsArray = parsedData[key];
            foundArray = true;
            break;
          }
        }

        if (!foundArray) {
          flightsArray = [parsedData];
        }
      }

      if (shouldLog) {
        log.debug({
          operation: 'claude_text_parse_flights_found',
          context: {
            flightCount: flightsArray.length,
            rawFlights: flightsArray,
          },
        });
      } else {
        logger.info(`[Claude Text Parser] Found ${flightsArray.length} flight(s)`);
        logger.debug({ rawFlights: flightsArray }, '[Claude Text Parser] Raw flights from LLM');
      }

      // Filter out completely invalid flights (missing critical fields)
      const filteredFlights = flightsArray.filter((flight: any) =>
        flight.flightNumber && flight.departureCode && flight.arrivalCode
      );

      const filteredOut = flightsArray.filter((flight: any) =>
        !flight.flightNumber || !flight.departureCode || !flight.arrivalCode
      );

      if (filteredOut.length > 0) {
        if (shouldLog) {
          log.warn({
            operation: 'claude_text_parse_flights_filtered',
            context: {
              filteredCount: filteredOut.length,
              filtered: filteredOut.map((f: any) => ({
                flightNumber: f.flightNumber || 'MISSING',
                departureCode: f.departureCode || 'MISSING',
                arrivalCode: f.arrivalCode || 'MISSING',
              })),
            },
          });
        } else {
          logger.warn({
            count: filteredOut.length,
            filtered: filteredOut.map((f: any) => ({
              flightNumber: f.flightNumber || 'MISSING',
              departureCode: f.departureCode || 'MISSING',
              arrivalCode: f.arrivalCode || 'MISSING',
            }))
          }, '[Claude Text Parser] Flights filtered out due to missing critical fields');
        }
      }

      // Normalize remaining flights
      const results: ParsedBooking[] = filteredFlights.map((flight: any) => normalizeParsedBooking(flight));
      const totalDuration = Date.now() - startTime;

      if (shouldLog) {
        log.info({
          operation: 'claude_text_parse_complete',
          context: {
            flightCount: results.length,
            inputTokens,
            outputTokens,
            totalTokens,
            apiDuration,
            totalDuration,
            performance: {
              tokensPerSecond: totalTokens / (apiDuration / 1000),
            },
          },
        });
      } else {
        logger.info(
          { tokensUsed: totalTokens },
          `[Claude Text Parser] Parsing complete - ${results.length} valid flight(s)`
        );
      }

        return results;
      } catch (error: any) {
        lastError = error;
        
        // For 404 errors (model not found), try next model
        if (error?.status === 404) {
          const modelError = error?.error?.error?.message || '';
          if (shouldLog) {
            log.warn({
              operation: 'claude_text_parse_model_not_found_retry',
              context: {
                model,
                attempt: i + 1,
                modelError,
                willRetry: !isLastAttempt,
              },
            });
          } else {
            logger.warn({ 
              model,
              attempt: i + 1,
              message: modelError 
            }, `[Claude Text Parser] Model not found, ${isLastAttempt ? 'no more models to try' : 'trying next model'}`);
          }
          
          // If this is the last model, throw error
          if (isLastAttempt) {
            throw new Error(`Claude model not found: ${modelError || model}. Tried all available models. Please check your CLAUDE_MODEL environment variable or API key permissions.`);
          }
          
          // Continue to next model
          continue;
        }
        
        // For other errors (401, 429, etc.), throw immediately
        const totalDuration = Date.now() - startTime;
        const errorContext = {
          model,
          textLength: text.length,
          totalDuration,
          status: error?.status,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorStack: error instanceof Error ? error.stack : undefined,
        };

        if (error?.status === 401) {
          if (shouldLog) {
            log.error({
              operation: 'claude_text_parse_auth_error',
              context: errorContext,
            });
          }
          throw new Error('Invalid Claude API key');
        }

        if (error?.status === 429) {
          if (shouldLog) {
            log.error({
              operation: 'claude_text_parse_rate_limit',
              context: errorContext,
            });
          }
          throw new Error('Claude API rate limit exceeded');
        }

        if (shouldLog) {
          log.error({
            operation: 'claude_text_parse_unexpected_error',
            context: errorContext,
          });
        } else {
          logger.error({ error }, '[Claude Text Parser] Parsing failed');
        }
        throw new Error(`Claude parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // If we get here, all models failed with 404
    throw new Error(`All Claude models failed. Last error: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
  }
}

// Singleton instance
let instance: ClaudeTextParser | null = null;

export function getClaudeTextParser(): ClaudeTextParser {
  if (!instance) {
    instance = new ClaudeTextParser();
  }
  return instance;
}
