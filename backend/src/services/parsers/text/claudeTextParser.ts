import Anthropic from '@anthropic-ai/sdk';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getTextParserPrompt } from '../shared/utils';
import logger from '../../../utils/logger';

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';

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
          model: CLAUDE_MODEL,
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
    logger.info('[Claude Text Parser] Starting email parsing');
    logger.info({ model: CLAUDE_MODEL }, '[Claude Text Parser] Model');

    try {
      const client = this.getClient(apiKey);
      const prompt = getTextParserPrompt(subject, text);

      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const rawResponse = response.content[0]?.type === 'text' ? response.content[0].text : '';

      if (!rawResponse) {
        logger.error('[Claude Text Parser] Empty response');
        throw new Error('Empty response from Claude API');
      }

      logger.debug({ rawResponse }, '[Claude Text Parser] Raw response (full)');

      // Parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);
      let parsedData: any;

      try {
        parsedData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.error({ response: rawResponse }, '[Claude Text Parser] JSON parse error');
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

      logger.info(`[Claude Text Parser] Found ${flightsArray.length} flight(s)`);
      logger.debug({ rawFlights: flightsArray }, '[Claude Text Parser] Raw flights from LLM');

      // Filter out completely invalid flights (missing critical fields)
      const filteredFlights = flightsArray.filter((flight: any) =>
        flight.flightNumber && flight.departureCode && flight.arrivalCode
      );

      const filteredOut = flightsArray.filter((flight: any) =>
        !flight.flightNumber || !flight.departureCode || !flight.arrivalCode
      );

      if (filteredOut.length > 0) {
        logger.warn({
          count: filteredOut.length,
          filtered: filteredOut.map((f: any) => ({
            flightNumber: f.flightNumber || 'MISSING',
            departureCode: f.departureCode || 'MISSING',
            arrivalCode: f.arrivalCode || 'MISSING',
          }))
        }, '[Claude Text Parser] Flights filtered out due to missing critical fields');
      }

      // Normalize remaining flights
      const results: ParsedBooking[] = filteredFlights.map((flight: any) => normalizeParsedBooking(flight));

      logger.info(
        { tokensUsed: response.usage.input_tokens + response.usage.output_tokens },
        `[Claude Text Parser] Parsing complete - ${results.length} valid flight(s)`
      );

      return results;
    } catch (error: any) {
      if (error?.status === 401) {
        throw new Error('Invalid Claude API key');
      }

      if (error?.status === 429) {
        throw new Error('Claude API rate limit exceeded');
      }

      logger.error({ error }, '[Claude Text Parser] Parsing failed');
      throw new Error(`Claude parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
