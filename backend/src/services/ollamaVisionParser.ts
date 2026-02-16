import axios from 'axios';
import { ParsedBooking } from './bookingParser';
import logger from '../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:latest';

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
 * Parse boarding pass image using Ollama Vision models
 * Supports models: llava, llava:13b, bakllava, etc.
 */
export async function parseWithOllamaVision(imageBase64: string): Promise<ParsedBooking> {
  logger.info('[Ollama Vision Parser] Starting boarding pass parsing');
  logger.info({ model: OLLAMA_VISION_MODEL }, '[Ollama Vision Parser] Model');

  const prompt = `You are an expert boarding pass analyzer. Extract flight information from this boarding pass image.

CRITICAL RULES:
1. IATA airport codes are ALWAYS exactly 3 uppercase letters (e.g., MUC, FRA, LUX, BER)
2. Flight numbers format: 2-letter airline code + 1-4 digits (e.g., LH103, FR8234, BA472)
3. Dates in ISO 8601 format: YYYY-MM-DDTHH:MM (e.g., 2025-12-05T14:30)
4. Extract the date from the boarding pass (often shown as DAY MONTH YEAR or DD MMM)
5. If a field is not visible or readable, use null

FIELDS TO EXTRACT:
- airline: Full airline name (e.g., "Lufthansa", "Ryanair")
- flightNumber: e.g., "LH103"
- departureCode: Departure airport IATA code (3 letters)
- arrivalCode: Arrival airport IATA code (3 letters)
- departureTime: Departure date and time in ISO format
- arrivalTime: Arrival date and time in ISO format (if available)
- seat: Seat number (e.g., "26F", "12A")
- gate: Gate number (e.g., "B45", "A12")
- terminal: Terminal (e.g., "1", "2", "A")
- pnr: Booking reference/PNR (usually 6 alphanumeric characters)
- boardingGroup: Boarding group/zone (e.g., "1", "A", "Zone 3")
- seatClass: e.g., "Economy", "Business", "First"
- aircraft: Aircraft type if visible (e.g., "A321", "Boeing 737")

Return ONLY valid JSON (no markdown formatting) in this exact structure:
{
  "airline": "string or null",
  "flightNumber": "string or null",
  "departureCode": "string or null",
  "arrivalCode": "string or null",
  "departureTime": "string or null",
  "arrivalTime": "string or null",
  "seat": "string or null",
  "gate": "string or null",
  "terminal": "string or null",
  "pnr": "string or null",
  "bookingReference": "string or null",
  "boardingGroup": "string or null",
  "seatClass": "string or null",
  "aircraft": "string or null",
  "price": null,
  "currency": null,
  "taxes": null,
  "fees": null,
  "ticketNumber": null
}`;

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
          num_predict: 500,
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
    logger.info({ rawResponse: rawResponse.substring(0, 200) }, '[Ollama Vision Parser] Raw response');

    // Clean the response (remove markdown formatting if present)
    let cleanedResponse = rawResponse;

    // Remove markdown code blocks
    if (cleanedResponse.includes('```json')) {
      cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleanedResponse.includes('```')) {
      cleanedResponse = cleanedResponse.replace(/```\n?/g, '');
    }

    // Try to find JSON in the response
    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('[Ollama Vision Parser] No JSON found in response');
      throw new Error('Invalid response format: No JSON found');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate IATA codes (must be exactly 3 uppercase letters)
    if (parsed.departureCode && !/^[A-Z]{3}$/.test(parsed.departureCode)) {
      logger.warn(`[Ollama Vision Parser] Invalid departure code: ${parsed.departureCode}`);
      parsed.departureCode = null;
    }
    if (parsed.arrivalCode && !/^[A-Z]{3}$/.test(parsed.arrivalCode)) {
      logger.warn(`[Ollama Vision Parser] Invalid arrival code: ${parsed.arrivalCode}`);
      parsed.arrivalCode = null;
    }

    // Ensure missing array is present
    const missing: string[] = [];
    if (!parsed.departureCode) missing.push('departureCode');
    if (!parsed.arrivalCode) missing.push('arrivalCode');
    if (!parsed.flightNumber) missing.push('flightNumber');
    if (!parsed.departureTime) missing.push('departureTime');

    const result: ParsedBooking = {
      ...parsed,
      missing,
    };

    logger.info({
      flightNumber: result.flightNumber,
      route: `${result.departureCode} → ${result.arrivalCode}`,
      missingFields: missing.length,
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

/**
 * Check if Ollama Vision service is available and model is installed
 */
export async function checkOllamaVisionAvailability(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 5000,
    });

    const models = response.data.models || [];
    const hasVisionModel = models.some((m: { name: string }) =>
      m.name.includes('llava') || m.name.includes('bakllava') || m.name === OLLAMA_VISION_MODEL
    );

    if (!hasVisionModel) {
      logger.warn(`[Ollama Vision Parser] No vision model found. Install with: ollama pull ${OLLAMA_VISION_MODEL}`);
    }

    return hasVisionModel;
  } catch (error) {
    logger.warn('[Ollama Vision Parser] Ollama service not available');
    return false;
  }
}
