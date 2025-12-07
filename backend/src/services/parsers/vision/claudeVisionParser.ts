import Anthropic from '@anthropic-ai/sdk';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getVisionParserPrompt } from '../shared/utils';
import logger from '../../../utils/logger';

const CLAUDE_VISION_MODEL = process.env.CLAUDE_VISION_MODEL || 'claude-3-5-sonnet-20240620';

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
          model: CLAUDE_VISION_MODEL,
          cost: '~$0.01-0.03 per image',
        },
      };
    } catch (error: any) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseImage(imageBase64: string, apiKey?: string): Promise<ParsedBooking> {
    logger.info('[Claude Vision Parser] Starting boarding pass parsing');
    logger.info({ model: CLAUDE_VISION_MODEL }, '[Claude Vision Parser] Model');

    try {
      const client = this.getClient(apiKey);
      const prompt = getVisionParserPrompt();

      // Determine image media type from base64 prefix or assume JPEG
      const mediaType = this.detectMediaType(imageBase64);

      const response = await client.messages.create({
        model: CLAUDE_VISION_MODEL,
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

      const rawResponse = response.content[0]?.type === 'text' ? response.content[0].text : '';

      if (!rawResponse) {
        logger.error('[Claude Vision Parser] Empty response from API');
        throw new Error('Empty response from Claude API');
      }

      logger.debug({ rawResponse }, '[Claude Vision Parser] Raw response (full)');

      // Clean and parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);

      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('[Claude Vision Parser] No JSON found in response');
        throw new Error('Invalid response format: No JSON found');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Normalize and validate
      const result = normalizeParsedBooking(parsed);

      logger.info({
        flightNumber: result.flightNumber,
        route: `${result.departureCode} → ${result.arrivalCode}`,
        missingFields: result.missing.length,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      }, '[Claude Vision Parser] Extraction complete');

      return result;
    } catch (error: any) {
      if (error?.status === 401) {
        logger.error('[Claude Vision Parser] Invalid API key');
        throw new Error('Invalid Claude API key');
      }

      if (error?.status === 429) {
        logger.error('[Claude Vision Parser] Rate limit exceeded');
        throw new Error('Claude API rate limit exceeded. Please try again later.');
      }

      if (error?.status === 400) {
        logger.error({ error: error.message }, '[Claude Vision Parser] Bad request');
        throw new Error(`Claude API error: ${error.message}`);
      }

      if (error instanceof SyntaxError) {
        logger.error({ error: error.message }, '[Claude Vision Parser] JSON parse error');
        throw new Error('Failed to parse Claude response as JSON');
      }

      logger.error({ error }, '[Claude Vision Parser] Unexpected error');
      throw new Error(`Claude Vision parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect media type from base64 string or file signature
   */
  private detectMediaType(base64: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    // Check for data URL prefix
    if (base64.startsWith('data:image/')) {
      const match = base64.match(/^data:(image\/[a-z]+);base64,/);
      if (match) {
        return match[1] as any;
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
