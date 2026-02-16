import axios from 'axios';
import { ITextParser, ProviderAvailability, TextProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getTextParserPrompt } from '../shared/utils';
import logger from '../../../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL_DEFAULT = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Ollama Text Parser
 *
 * Uses local Ollama with text models for email parsing.
 *
 * Pros:
 * - Free and local
 * - Good accuracy with proper models
 * - No API costs
 * - Privacy-preserving
 *
 * Cons:
 * - Requires Ollama installation
 * - Needs good hardware (GPU recommended)
 * - Model downloads (~2-7GB)
 */
export class OllamaTextParser implements ITextParser {
  readonly provider: TextProvider = 'ollama';
  private modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName || OLLAMA_MODEL_DEFAULT;
  }

  async checkAvailability(): Promise<ProviderAvailability> {
    try {
      const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
        timeout: 3000,
      });

      const models: Array<{ name: string }> = response.data.models || [];
      const hasModel = models.some((m) => m.name === this.modelName || m.name.startsWith(this.modelName.split(':')[0]));

      if (!hasModel) {
        return {
          available: false,
          reason: `Model '${this.modelName}' not found. Install with: ollama pull ${this.modelName}`,
          metadata: {
            ollamaUrl: OLLAMA_URL,
            requestedModel: this.modelName,
            availableModels: models.map((m) => m.name),
          },
        };
      }

      return {
        available: true,
        metadata: {
          provider: 'ollama',
          model: this.modelName,
          url: OLLAMA_URL,
          cost: 'free',
        },
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
        return {
          available: false,
          reason: 'Ollama service not running. Start with: ollama serve',
        };
      }

      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async parseEmail(subject: string, text: string, html?: string): Promise<ParsedBooking[]> {
    logger.info('[Ollama Text Parser] Starting email parsing');
    logger.info({ model: this.modelName }, '[Ollama Text Parser] Model');

    const prompt = getTextParserPrompt(subject, text);

    try {
      const startTime = Date.now();

      const response = await axios.post<OllamaResponse>(
        `${OLLAMA_URL}/api/generate`,
        {
          model: this.modelName,
          prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.05,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            num_predict: 2000,
          },
        },
        {
          timeout: 90000,
        }
      );

      const duration = Date.now() - startTime;
      logger.info(`[Ollama Text Parser] Response received in ${duration}ms`);

      // Parse JSON response
      const cleanedResponse = cleanLLMJsonResponse(response.data.response.trim());

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.error({ response: response.data.response }, '[Ollama Text Parser] Failed to parse response');
        throw new Error('LLM returned invalid JSON');
      }

      // Normalize to array format
      let flightsArray: Record<string, unknown>[] = [];

      if (Array.isArray(parsedData)) {
        flightsArray = parsedData as Record<string, unknown>[];
      } else if (parsedData && typeof parsedData === 'object') {
        // Check for nested arrays
        const possibleKeys = ['flights', 'flightNumbers', 'data', 'results', 'items'];
        let foundArray = false;
        const dataObj = parsedData as Record<string, unknown>;

        for (const key of possibleKeys) {
          if (Array.isArray(dataObj[key])) {
            flightsArray = dataObj[key] as Record<string, unknown>[];
            foundArray = true;
            break;
          }
        }

        if (!foundArray) {
          flightsArray = [dataObj];
        }
      }

      logger.info(`[Ollama Text Parser] Found ${flightsArray.length} flight(s)`);
      logger.debug({ rawFlights: flightsArray }, '[Ollama Text Parser] Raw flights from LLM');

      // Filter out completely invalid flights (missing critical fields)
      const filteredFlights = flightsArray.filter((flight) =>
        flight.flightNumber && flight.departureCode && flight.arrivalCode
      );

      const filteredOut = flightsArray.filter((flight) =>
        !flight.flightNumber || !flight.departureCode || !flight.arrivalCode
      );

      if (filteredOut.length > 0) {
        logger.warn({
          count: filteredOut.length,
          filtered: filteredOut.map((f) => ({
            flightNumber: (f.flightNumber as string) || 'MISSING',
            departureCode: (f.departureCode as string) || 'MISSING',
            arrivalCode: (f.arrivalCode as string) || 'MISSING',
          }))
        }, '[Ollama Text Parser] Flights filtered out due to missing critical fields');
      }

      // Normalize remaining flights
      const results: ParsedBooking[] = filteredFlights.map((flight) => normalizeParsedBooking(flight));

      logger.info(`[Ollama Text Parser] Parsing complete - ${results.length} valid flight(s)`);

      return results;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          logger.error('[Ollama Text Parser] Cannot connect to Ollama');
          throw new Error('Ollama service is not available');
        }
        logger.error({ error: error.message }, '[Ollama Text Parser] Axios error');
        throw new Error(`Ollama API error: ${error.message}`);
      }

      logger.error({ error }, '[Ollama Text Parser] Unexpected error');
      throw error;
    }
  }
}

// Factory function - creates new instance with model name
export function getOllamaTextParser(modelName?: string): OllamaTextParser {
  return new OllamaTextParser(modelName);
}
