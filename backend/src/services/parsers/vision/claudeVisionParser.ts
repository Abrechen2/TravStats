import Anthropic from '@anthropic-ai/sdk';
import { APIError as AnthropicAPIError } from '@anthropic-ai/sdk/core/error';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getVisionParserPrompt, getLatestClaudeVisionModel, getClaudeVisionModels } from '../shared/utils';
import logger, { parserVisionLogger } from '../../../utils/logger';
import { shouldLogParserOperations } from '../../loggingConfig';

/**
 * Get Claude vision model - uses env var if set, otherwise latest available model
 */
function getClaudeVisionModel(): string {
  return getLatestClaudeVisionModel();
}

/**
 * Claude 3.5 Sonnet Vision Parser
 *
 * Uses Anthropic's Claude 3.5 Sonnet with vision capabilities
 * for boarding pass parsing.
 *
 * Pros:
 * - Excellent accuracy and reliability
 * - Strong structured data extraction
 * - Fast inference
 * - No local hardware requirements
 *
 * Cons:
 * - Requires API key and credits
 * - Cost: ~$0.01-0.03 per boarding pass
 * - Requires internet connection
 * - Data sent to Anthropic servers
 */
export class ClaudeVisionParser implements IVisionParser {
  readonly provider: VisionProvider = 'claude';
  private client: Anthropic | null = null;

  /**
   * Get or create Anthropic client
   */
  private getClient(apiKey?: string): Anthropic {
    const key = apiKey || process.env.CLAUDE_API_KEY;

    if (!key) {
      throw new Error('Claude API key not configured');
    }

    if (!this.client || apiKey) {
      this.client = new Anthropic({ apiKey: key });
    }

    return this.client;
  }

  async checkAvailability(apiKey?: string): Promise<ProviderAvailability> {
    try {
      const key = apiKey || process.env.CLAUDE_API_KEY;

      if (!key) {
        return {
          available: false,
          reason: 'Claude API key not configured',
          metadata: {
            hint: 'Set CLAUDE_API_KEY environment variable or provide user API key',
          },
        };
      }

      // Test API key validity with a minimal request
      // Note: Anthropic doesn't have a models endpoint, so we just verify the key format
      if (!/^sk-ant-/.test(key)) {
        return {
          available: false,
          reason: 'Invalid Claude API key format (should start with sk-ant-)',
        };
      }

      return {
        available: true,
        metadata: {
          provider: 'claude',
          model: getClaudeVisionModel(),
          cost: '~$0.01-0.03 per image',
        },
      };
    } catch (error: unknown) {
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

    const modelsToTry = getClaudeVisionModels();
    const client = this.getClient(apiKey);
    const prompt = getVisionParserPrompt();
    
    let lastError: unknown = null;
    
    // Try each model in order until one works
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      const isFirstAttempt = i === 0;
      const isLastAttempt = i === modelsToTry.length - 1;
      
      if (shouldLog) {
        log.info({
          operation: isFirstAttempt ? 'claude_vision_parse_start' : 'claude_vision_parse_retry',
          context: {
            model,
            attempt: i + 1,
            totalModels: modelsToTry.length,
            imageSize: imageBase64.length,
            mediaType: this.detectMediaType(imageBase64),
            previousError: lastError ? (lastError instanceof Error ? lastError.message : 'Unknown error') : undefined,
          },
        });
      } else {
        if (isFirstAttempt) {
          logger.info('[Claude Vision Parser] Starting boarding pass parsing');
        } else {
          logger.info({ model, attempt: i + 1 }, '[Claude Vision Parser] Retrying with different model');
        }
        logger.info({ model }, '[Claude Vision Parser] Model');
      }

      try {
        // Determine image media type from base64 prefix or assume JPEG
        const mediaType = this.detectMediaType(imageBase64);

        const apiStartTime = Date.now();
        const response = await client.messages.create({
          model,
        max_tokens: 1024,
        temperature: 0.1, // Low temperature for factual extraction
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
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
            operation: 'claude_vision_parse_empty_response',
            context: {
              apiDuration,
              inputTokens,
            },
          });
        } else {
          logger.error('[Claude Vision Parser] Empty response from API');
        }
        throw new Error('Empty response from Claude API');
      }

      if (shouldLog) {
        log.debug({
          operation: 'claude_vision_parse_raw_response',
          context: {
            rawResponseLength: rawResponse.length,
            inputTokens,
            outputTokens,
            totalTokens,
            apiDuration,
          },
        });
      } else {
        logger.debug({ rawResponse }, '[Claude Vision Parser] Raw response (full)');
      }

      // Clean and parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);

      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (shouldLog) {
          log.error({
            operation: 'claude_vision_parse_no_json',
            context: {
              rawResponseLength: rawResponse.length,
              cleanedResponseLength: cleanedResponse.length,
            },
          });
        } else {
          logger.error('[Claude Vision Parser] No JSON found in response');
        }
        throw new Error('Invalid response format: No JSON found');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Normalize and validate
      const result = normalizeParsedBooking(parsed);
      const totalDuration = Date.now() - startTime;

      if (shouldLog) {
        log.info({
          operation: 'claude_vision_parse_complete',
          context: {
            flightNumber: result.flightNumber,
            route: `${result.departureCode} → ${result.arrivalCode}`,
            missingFields: result.missing.length,
            missingFieldsList: result.missing,
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
        logger.info({
          flightNumber: result.flightNumber,
          route: `${result.departureCode} → ${result.arrivalCode}`,
          missingFields: result.missing.length,
          tokensUsed: totalTokens,
        }, '[Claude Vision Parser] Extraction complete');
      }

        return result;
      } catch (error: unknown) {
        lastError = error;

        const isApiError = error instanceof AnthropicAPIError;
        const statusCode = isApiError ? error.status : undefined;

        // For 404 errors (model not found), try next model
        if (statusCode === 404) {
          const apiErrorBody = isApiError ? error.error : undefined;
          const nestedError = apiErrorBody && typeof apiErrorBody === 'object' && 'error' in apiErrorBody
            ? (apiErrorBody as { error?: { message?: string } }).error
            : undefined;
          const modelError = nestedError?.message || '';
          if (shouldLog) {
            log.warn({
              operation: 'claude_vision_parse_model_not_found_retry',
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
            }, `[Claude Vision Parser] Model not found, ${isLastAttempt ? 'no more models to try' : 'trying next model'}`);
          }

          // If this is the last model, throw error
          if (isLastAttempt) {
            throw new Error(`Claude model not found: ${modelError || model}. Tried all available models. Please check your CLAUDE_VISION_MODEL environment variable or API key permissions.`);
          }

          // Continue to next model
          continue;
        }

        // For other errors (401, 429, etc.), throw immediately
        const totalDuration = Date.now() - startTime;
        const errorContext = {
          model,
          imageSize: imageBase64.length,
          totalDuration,
          status: statusCode,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorStack: error instanceof Error ? error.stack : undefined,
        };

        if (statusCode === 401) {
          if (shouldLog) {
            log.error({
              operation: 'claude_vision_parse_auth_error',
              context: errorContext,
            });
          } else {
            logger.error('[Claude Vision Parser] Invalid API key');
          }
          throw new Error('Invalid Claude API key');
        }

        if (statusCode === 429) {
          if (shouldLog) {
            log.error({
              operation: 'claude_vision_parse_rate_limit',
              context: errorContext,
            });
          } else {
            logger.error('[Claude Vision Parser] Rate limit exceeded');
          }
          throw new Error('Claude API rate limit exceeded. Please try again later.');
        }

        if (statusCode === 400) {
          if (shouldLog) {
            log.error({
              operation: 'claude_vision_parse_bad_request',
              context: errorContext,
            });
          } else {
            logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, '[Claude Vision Parser] Bad request');
          }
          throw new Error(`Claude API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        if (error instanceof SyntaxError) {
          if (shouldLog) {
            log.error({
              operation: 'claude_vision_parse_json_error',
              context: errorContext,
            });
          } else {
            logger.error({ error: error.message }, '[Claude Vision Parser] JSON parse error');
          }
          throw new Error('Failed to parse Claude response as JSON');
        }

        if (shouldLog) {
          log.error({
            operation: 'claude_vision_parse_unexpected_error',
            context: errorContext,
          });
        } else {
          logger.error({ error }, '[Claude Vision Parser] Unexpected error');
        }
        throw new Error(`Claude Vision parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // If we get here, all models failed with 404
    throw new Error(`All Claude models failed. Last error: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`);
  }

  /**
   * Detect media type from base64 string or file signature
   */
  private detectMediaType(base64: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    // Check for data URL prefix
    if (base64.startsWith('data:image/')) {
      const match = base64.match(/^data:(image\/[a-z]+);base64,/);
      if (match) {
        return match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      }
    }

    // Decode first few bytes to check file signature
    const bytes = Buffer.from(base64.substring(0, 16), 'base64');

    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return 'image/png';
    }

    // GIF: 47 49 46
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }

    // WebP: 52 49 46 46 ... 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'image/webp';
    }

    // Default to JPEG
    return 'image/jpeg';
  }
}

// Singleton instance
let instance: ClaudeVisionParser | null = null;

export function getClaudeVisionParser(): ClaudeVisionParser {
  if (!instance) {
    instance = new ClaudeVisionParser();
  }
  return instance;
}
