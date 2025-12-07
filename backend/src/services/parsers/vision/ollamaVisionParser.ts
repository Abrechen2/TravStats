import axios from 'axios';
import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { normalizeParsedBooking, cleanLLMJsonResponse, getVisionParserPrompt } from '../shared/utils';
import logger from '../../../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';

interface OllamaVisionResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
}

/**
 * Ollama Vision Parser
 *
 * Uses local Ollama with vision models (llava, bakllava, etc.)
 * for boarding pass parsing.
 *
 * Pros:
 * - Free and local
 * - Good accuracy with vision models
 * - No API costs
 * - Privacy-preserving
 *
 * Cons:
 * - Requires Ollama installation
 * - Needs good hardware (GPU recommended)
 * - Large model downloads (~4-7GB)
 */
export class OllamaVisionParser implements IVisionParser {
  readonly provider: VisionProvider = 'ollama';

  async checkAvailability(): Promise<ProviderAvailability> {
    try {
      const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
        timeout: 5000,
      });

      const models = response.data.models || [];
      const hasVisionModel = models.some((m: any) =>
        m.name.includes('llava') || m.name.includes('bakllava') || m.name === OLLAMA_VISION_MODEL
      );

      if (!hasVisionModel) {
        return {
          available: false,
          reason: `Vision model '${OLLAMA_VISION_MODEL}' not found. Install with: ollama pull ${OLLAMA_VISION_MODEL}`,
          metadata: {
            ollamaUrl: OLLAMA_URL,
            requestedModel: OLLAMA_VISION_MODEL,
            availableModels: models.map((m: any) => m.name),
          },
        };
      }

      return {
        available: true,
        metadata: {
          provider: 'ollama',
          model: OLLAMA_VISION_MODEL,
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

  async parseImage(imageBase64: string): Promise<ParsedBooking> {
    logger.info('[Ollama Vision Parser] Starting boarding pass parsing');
    logger.info({ model: OLLAMA_VISION_MODEL }, '[Ollama Vision Parser] Model');

    const prompt = getVisionParserPrompt();

    try {
      const response = await axios.post<OllamaVisionResponse>(
        `${OLLAMA_URL}/api/generate`,
        {
          model: OLLAMA_VISION_MODEL,
          prompt,
          images: [imageBase64],
          stream: false,
          options: {
            temperature: 0.1, // Low temperature for factual extraction
            num_predict: 1200, // Increased to ensure full JSON response including arrivalTime
          },
        },
        {
          timeout: 60000, // 60 second timeout for vision models
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const rawResponse = response.data.response.trim();
      logger.debug({ rawResponse }, '[Ollama Vision Parser] Raw response (full)');

      // Clean the response (remove markdown formatting if present)
      const cleanedResponse = cleanLLMJsonResponse(rawResponse);

      // Try to find JSON in the response
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('[Ollama Vision Parser] No JSON found in response');
        throw new Error('Invalid response format: No JSON found');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Normalize and validate
      const result = normalizeParsedBooking(parsed);

      logger.info({
        flightNumber: result.flightNumber,
        route: `${result.departureCode} → ${result.arrivalCode}`,
        missingFields: result.missing.length,
      }, '[Ollama Vision Parser] Extraction complete');

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          logger.error('[Ollama Vision Parser] Ollama is not running or not accessible');
          throw new Error('Ollama Vision service unavailable. Please ensure Ollama is running with a vision model.');
        }
        if (error.response?.status === 404) {
          logger.error(`[Ollama Vision Parser] Model ${OLLAMA_VISION_MODEL} not found`);
          throw new Error(`Vision model '${OLLAMA_VISION_MODEL}' not found. Please install it with: ollama pull ${OLLAMA_VISION_MODEL}`);
        }
        logger.error({ error: error.message }, '[Ollama Vision Parser] HTTP error');
        throw new Error(`Ollama Vision API error: ${error.message}`);
      }

      if (error instanceof SyntaxError) {
        logger.error({ error: error.message }, '[Ollama Vision Parser] JSON parse error');
        throw new Error('Failed to parse Ollama Vision response as JSON');
      }

      logger.error({ error }, '[Ollama Vision Parser] Unexpected error');
      throw error;
    }
  }
}

// Singleton instance
let instance: OllamaVisionParser | null = null;

export function getOllamaVisionParser(): OllamaVisionParser {
  if (!instance) {
    instance = new OllamaVisionParser();
  }
  return instance;
}
