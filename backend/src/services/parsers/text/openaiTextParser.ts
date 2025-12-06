import OpenAI from 'openai';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getTextParserPrompt } from '../shared/utils';
import logger from '../../../utils/logger';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * OpenAI GPT-4 Text Parser
 *
 * Uses OpenAI's GPT-4 for email parsing.
 *
 * Pros:
 * - Excellent accuracy
 * - Fast inference
 * - Handles complex/multi-flight emails well
 *
 * Cons:
 * - Requires API key and credits
 * - Cost: ~$0.002-0.01 per email
 * - Data sent to OpenAI servers
 */
export class OpenAITextParser implements ITextParser {
  readonly provider: TextProvider = 'openai';
  private client: OpenAI | null = null;

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
        };
      }

      const client = this.getClient(key);
      await client.models.retrieve(OPENAI_MODEL);

      return {
        available: true,
        metadata: {
          provider: 'openai',
          model: OPENAI_MODEL,
          cost: '~$0.002-0.01 per email',
        },
      };
    } catch (error: any) {
      if (error?.status === 401) {
        return {
          available: false,
          reason: 'Invalid OpenAI API key',
        };
      }

      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseEmail(subject: string, text: string, html?: string, apiKey?: string): Promise<ParsedBooking[]> {
    logger.info('[OpenAI Text Parser] Starting email parsing');
    logger.info({ model: OPENAI_MODEL }, '[OpenAI Text Parser] Model');

    try {
      const client = this.getClient(apiKey);
      const prompt = getTextParserPrompt(subject, text);

      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert flight booking email parser. Extract flight information and return valid JSON arrays only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000,
      });

      const rawResponse = response.choices[0]?.message?.content?.trim();

      if (!rawResponse) {
        logger.error('[OpenAI Text Parser] Empty response');
        throw new Error('Empty response from OpenAI API');
      }

      logger.debug({ response: rawResponse.substring(0, 200) }, '[OpenAI Text Parser] Raw response');

      // Parse JSON
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);
      let parsedData: any;

      try {
        parsedData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.error({ response: rawResponse }, '[OpenAI Text Parser] JSON parse error');
        throw new Error('Failed to parse OpenAI response as JSON');
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

      logger.info(`[OpenAI Text Parser] Found ${flightsArray.length} flight(s)`);

      const results: ParsedBooking[] = flightsArray
        .filter((flight: any) => flight.flightNumber && flight.departureCode && flight.arrivalCode)
        .map((flight: any) => normalizeParsedBooking(flight));

      logger.info(
        { tokensUsed: response.usage?.total_tokens },
        `[OpenAI Text Parser] Parsing complete - ${results.length} valid flight(s)`
      );

      return results;
    } catch (error: any) {
      if (error?.status === 401) {
        throw new Error('Invalid OpenAI API key');
      }

      if (error?.status === 429) {
        throw new Error('OpenAI API rate limit exceeded');
      }

      logger.error({ error }, '[OpenAI Text Parser] Parsing failed');
      throw new Error(`OpenAI parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let instance: OpenAITextParser | null = null;

export function getOpenAITextParser(): OpenAITextParser {
  if (!instance) {
    instance = new OpenAITextParser();
  }
  return instance;
}
