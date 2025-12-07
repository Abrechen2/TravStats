import OpenAI from 'openai';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getVisionParserPrompt } from '../shared/utils';
import logger, { parserVisionLogger } from '../../../utils/logger';
import { shouldLogParserOperations } from '../../loggingConfig';

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

/**
 * OpenAI GPT-4 Vision Parser
 *
 * Uses OpenAI's GPT-4 Vision API for boarding pass parsing.
 *
 * Pros:
 * - Excellent accuracy
 * - Fast inference
 * - No local hardware requirements
 * - Regularly updated models
 *
 * Cons:
 * - Requires API key and credits
 * - Cost: ~$0.01-0.05 per boarding pass
 * - Requires internet connection
 * - Data sent to OpenAI servers
 */
export class OpenAIVisionParser implements IVisionParser {
  readonly provider: VisionProvider = 'openai';
  private client: OpenAI | null = null;

  /**
   * Get or create OpenAI client
   */
  private getClient(apiKey?: string): OpenAI {
    const key = apiKey || process.env.OPENAI_API_KEY;

    if (!key) {
      throw new Error('OpenAI API key not configured');
    }

    if (!this.client || apiKey) {
      this.client = new OpenAI({ apiKey: key });
    }

    return this.client;
  }

  async checkAvailability(apiKey?: string): Promise<ProviderAvailability> {
    try {
      const key = apiKey || process.env.OPENAI_API_KEY;

      if (!key) {
        return {
          available: false,
          reason: 'OpenAI API key not configured',
          metadata: {
            hint: 'Set OPENAI_API_KEY environment variable or provide user API key',
          },
        };
      }

      // Test API key validity with a minimal request
      const client = this.getClient(key);
      await client.models.retrieve(OPENAI_VISION_MODEL);

      return {
        available: true,
        metadata: {
          provider: 'openai',
          model: OPENAI_VISION_MODEL,
          cost: '~$0.01-0.05 per image',
        },
      };
    } catch (error: any) {
      if (error?.status === 401) {
        return {
          available: false,
          reason: 'Invalid OpenAI API key',
        };
      }

      if (error?.status === 404) {
        return {
          available: false,
          reason: `Model '${OPENAI_VISION_MODEL}' not found or not accessible`,
        };
      }

      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseImage(imageBase64: string, apiKey?: string): Promise<ParsedBooking> {
    const shouldLog = await shouldLogParserOperations();
    const log = shouldLog ? parserVisionLogger : logger;
    const startTime = Date.now();

    if (shouldLog) {
      log.info({
        operation: 'openai_vision_parse_start',
        context: {
          model: OPENAI_VISION_MODEL,
          imageSize: imageBase64.length,
        },
      });
    } else {
      logger.info('[OpenAI Vision Parser] Starting boarding pass parsing');
      logger.info({ model: OPENAI_VISION_MODEL }, '[OpenAI Vision Parser] Model');
    }

    try {
      const client = this.getClient(apiKey);
      const prompt = getVisionParserPrompt();

      const apiStartTime = Date.now();
      const response = await client.chat.completions.create({
        model: OPENAI_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: 'high', // Use high detail for better accuracy
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for factual extraction
      });
      const apiDuration = Date.now() - apiStartTime;

      const rawResponse = response.choices[0]?.message?.content?.trim();
      const totalTokens = response.usage?.total_tokens || 0;
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;

      if (!rawResponse) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_empty_response',
            context: {
              apiDuration,
              promptTokens,
            },
          });
        } else {
          logger.error('[OpenAI Vision Parser] Empty response from API');
        }
        throw new Error('Empty response from OpenAI API');
      }

      if (shouldLog) {
        log.debug({
          operation: 'openai_vision_parse_raw_response',
          context: {
            rawResponseLength: rawResponse.length,
            promptTokens,
            completionTokens,
            totalTokens,
            apiDuration,
          },
        });
      } else {
        logger.debug({ rawResponse }, '[OpenAI Vision Parser] Raw response (full)');
      }

      // Clean and parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);

      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_no_json',
            context: {
              rawResponseLength: rawResponse.length,
              cleanedResponseLength: cleanedResponse.length,
            },
          });
        } else {
          logger.error('[OpenAI Vision Parser] No JSON found in response');
        }
        throw new Error('Invalid response format: No JSON found');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Normalize and validate
      const result = normalizeParsedBooking(parsed);
      const totalDuration = Date.now() - startTime;

      if (shouldLog) {
        log.info({
          operation: 'openai_vision_parse_complete',
          context: {
            flightNumber: result.flightNumber,
            route: `${result.departureCode} → ${result.arrivalCode}`,
            missingFields: result.missing.length,
            missingFieldsList: result.missing,
            promptTokens,
            completionTokens,
            totalTokens,
            apiDuration,
            totalDuration,
            performance: {
              tokensPerSecond: totalTokens / (apiDuration / 1000),
            },
          },
        });
      } else {
        logger.info({
          flightNumber: result.flightNumber,
          route: `${result.departureCode} → ${result.arrivalCode}`,
          missingFields: result.missing.length,
          tokensUsed: totalTokens,
        }, '[OpenAI Vision Parser] Extraction complete');
      }

      return result;
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      const errorContext = {
        model: OPENAI_VISION_MODEL,
        imageSize: imageBase64.length,
        totalDuration,
        status: error?.status,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
      };

      if (error?.status === 401) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_auth_error',
            context: errorContext,
          });
        } else {
          logger.error('[OpenAI Vision Parser] Invalid API key');
        }
        throw new Error('Invalid OpenAI API key');
      }

      if (error?.status === 429) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_rate_limit',
            context: errorContext,
          });
        } else {
          logger.error('[OpenAI Vision Parser] Rate limit exceeded');
        }
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }

      if (error?.status === 400) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_bad_request',
            context: errorContext,
          });
        } else {
          logger.error({ error: error.message }, '[OpenAI Vision Parser] Bad request');
        }
        throw new Error(`OpenAI API error: ${error.message}`);
      }

      if (error instanceof SyntaxError) {
        if (shouldLog) {
          log.error({
            operation: 'openai_vision_parse_json_error',
            context: errorContext,
          });
        } else {
          logger.error({ error: error.message }, '[OpenAI Vision Parser] JSON parse error');
        }
        throw new Error('Failed to parse OpenAI response as JSON');
      }

      if (shouldLog) {
        log.error({
          operation: 'openai_vision_parse_unexpected_error',
          context: errorContext,
        });
      } else {
        logger.error({ error }, '[OpenAI Vision Parser] Unexpected error');
      }
      throw new Error(`OpenAI Vision parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let instance: OpenAIVisionParser | null = null;

export function getOpenAIVisionParser(): OpenAIVisionParser {
  if (!instance) {
    instance = new OpenAIVisionParser();
  }
  return instance;
}
