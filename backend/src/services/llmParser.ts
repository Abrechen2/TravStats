import axios from 'axios';
import { ParsedBooking } from './bookingParser';
import logger from '../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Parse flight booking email using Ollama LLM
 *
 * This is much more accurate than regex-based parsing as it understands
 * context and can handle various email formats from different airlines.
 * Can extract MULTIPLE flights from one email (e.g., round trips, multi-leg journeys).
 */
export async function parseEmailWithLLM(
  subject: string,
  text: string,
  html?: string
): Promise<ParsedBooking[]> {
  logger.debug({
    operation: 'llm_parser_start',
    message: 'Starting email parsing with Ollama',
    context: { model: OLLAMA_MODEL, url: OLLAMA_URL },
  });

  // Clean the text to remove excessive whitespace and null bytes
  const cleanText = text
    .replace(/\0/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 4000); // Limit to 4000 chars to avoid token limits

  const prompt = `You are a flight booking email parser. Extract ALL flight information from the email below.

IMPORTANT: If the email contains multiple flights (e.g., outbound + return, or multi-leg journey), extract EACH flight separately.

EMAIL SUBJECT: ${subject}

EMAIL BODY: ${cleanText}

Extract these fields for EACH flight (use null if not found):
- flightNumber: string (e.g., "LH103")
- departureCode: IATA airport code (e.g., "MUC")
- arrivalCode: IATA airport code (e.g., "LUX")
- departureTime: ISO 8601 datetime (e.g., "2025-11-18T11:00")
- arrivalTime: ISO 8601 datetime (e.g., "2025-11-18T13:55")
- pnr: booking reference (e.g., "9RFAA7")
- price: numeric string (e.g., "513.47")
- currency: ISO currency code (e.g., "EUR")
- seat: seat number (e.g., "26F")
- terminal: terminal (e.g., "2")
- gate: gate (e.g., "B12")

Return ONLY a JSON array of flights. If only one flight, still return an array with one element.

Example for round trip (MUC→LUX and LUX→MUC):
[
  {
    "flightNumber": "LH103",
    "departureCode": "MUC",
    "arrivalCode": "LUX",
    "departureTime": "2025-11-18T11:00",
    "arrivalTime": "2025-11-18T12:55",
    "pnr": "9RFAA7",
    "price": null,
    "currency": "EUR",
    "seat": "26F",
    "terminal": "2",
    "gate": null
  },
  {
    "flightNumber": "LH442",
    "departureCode": "LUX",
    "arrivalCode": "MUC",
    "departureTime": "2025-11-20T09:30",
    "arrivalTime": "2025-11-20T10:35",
    "pnr": "9RFAA7",
    "price": null,
    "currency": "EUR",
    "seat": null,
    "terminal": null,
    "gate": null
  }
]`;

  try {
    logger.debug({
      operation: 'llm_parser_request',
      message: 'Sending request to Ollama',
    });
    const startTime = Date.now();

    const response = await axios.post<OllamaResponse>(
      `${OLLAMA_URL}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json', // Force JSON output
        options: {
          temperature: 0.1, // Low temperature for consistent, factual output
          top_p: 0.9,
        },
      },
      {
        timeout: 60000, // 60 second timeout
      }
    );

    const duration = Date.now() - startTime;
    logger.debug({
      operation: 'llm_parser_response',
      message: 'Response received from Ollama',
      performance: { duration },
    });

    // Parse the JSON response
    let parsedData: unknown;
    try {
      // Remove any markdown code blocks if present
      let jsonText = response.data.response.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      parsedData = JSON.parse(jsonText);
      logger.debug({
        operation: 'llm_parser_parse',
        message: 'Successfully parsed LLM response',
        context: { flightCount: Array.isArray(parsedData) ? parsedData.length : 1 },
      });
    } catch (parseError) {
      logger.error({
        operation: 'llm_parser_parse_error',
        message: 'Failed to parse LLM response',
        context: { responsePreview: response.data.response.substring(0, 500) },
        error: {
          message: parseError instanceof Error ? parseError.message : 'Unknown error',
        },
      });
      throw new Error('LLM returned invalid JSON');
    }

    // Ensure we have an array
    const flightsArray: Record<string, unknown>[] = Array.isArray(parsedData)
      ? parsedData as Record<string, unknown>[]
      : [parsedData as Record<string, unknown>];
    logger.debug({
      operation: 'llm_parser_flights_found',
      message: `Found ${flightsArray.length} flight(s)`,
      context: { flightCount: flightsArray.length },
    });

    // Build ParsedBooking results for each flight
    const results: ParsedBooking[] = flightsArray.map((flight: Record<string, unknown>, index: number) => {
      const missing: string[] = [];
      if (!flight.flightNumber) missing.push('flightNumber');
      if (!flight.departureCode) missing.push('departureCode');
      if (!flight.arrivalCode) missing.push('arrivalCode');
      if (!flight.departureTime) missing.push('departureTime');
      if (!flight.arrivalTime) missing.push('arrivalTime');

      const flightNumber = typeof flight.flightNumber === 'string' ? flight.flightNumber : undefined;
      const result: ParsedBooking = {
        airline: flightNumber?.slice(0, 2) || undefined,
        flightNumber: flightNumber || undefined,
        departureCode: typeof flight.departureCode === 'string' ? flight.departureCode : undefined,
        arrivalCode: typeof flight.arrivalCode === 'string' ? flight.arrivalCode : undefined,
        departureTime: typeof flight.departureTime === 'string' ? flight.departureTime : undefined,
        arrivalTime: typeof flight.arrivalTime === 'string' ? flight.arrivalTime : undefined,
        pnr: typeof flight.pnr === 'string' ? flight.pnr : undefined,
        seat: typeof flight.seat === 'string' ? flight.seat : undefined,
        terminal: typeof flight.terminal === 'string' ? flight.terminal : undefined,
        gate: typeof flight.gate === 'string' ? flight.gate : undefined,
        price: typeof flight.price === 'string' ? flight.price : undefined,
        currency: typeof flight.currency === 'string' ? flight.currency : undefined,
        missing,
      };

      logger.debug({
        operation: 'llm_parser_flight_processed',
        message: `Processed flight ${index + 1}/${flightsArray.length}`,
        context: {
          flightNumber: result.flightNumber,
          departureCode: result.departureCode,
          arrivalCode: result.arrivalCode,
          missingFields: result.missing,
        },
      });
      return result;
    });

    logger.info({
      operation: 'llm_parser_complete',
      message: `Successfully extracted ${results.length} flight(s)`,
      context: { flightCount: results.length },
    });
    return results;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        logger.error({
          operation: 'llm_parser_connection_error',
          message: 'Cannot connect to Ollama service',
          context: { url: OLLAMA_URL },
          error: {
            message: 'Ollama service is not available',
            code: error.code,
          },
        });
        throw new Error('Ollama service is not available');
      }
      logger.error({
        operation: 'llm_parser_axios_error',
        message: 'Ollama API error',
        context: { url: OLLAMA_URL },
        error: {
          message: error.message,
          code: error.code,
          status: error.response?.status,
        },
      });
      throw new Error(`Ollama API error: ${error.message}`);
    }
    logger.error({
      operation: 'llm_parser_unexpected_error',
      message: 'Unexpected error in LLM parser',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Check if Ollama is available and healthy
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, {
      timeout: 3000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Ensure the required model is pulled/downloaded
 */
export async function ensureModelAvailable(): Promise<boolean> {
  try {
    logger.debug({
      operation: 'llm_parser_check_model',
      message: `Checking if model ${OLLAMA_MODEL} is available`,
      context: { model: OLLAMA_MODEL },
    });
    const response = await axios.get(`${OLLAMA_URL}/api/tags`);

    const models: Array<{ name: string }> = response.data.models || [];
    const modelExists = models.some((m) => m.name === OLLAMA_MODEL);

    if (!modelExists) {
      logger.info({
        operation: 'llm_parser_pull_model',
        message: `Model ${OLLAMA_MODEL} not found, pulling...`,
        context: { model: OLLAMA_MODEL },
      });

      // Pull the model (this can take a while)
      await axios.post(`${OLLAMA_URL}/api/pull`, {
        name: OLLAMA_MODEL,
        stream: false,
      }, {
        timeout: 600000, // 10 minute timeout for downloading
      });

      logger.info({
        operation: 'llm_parser_model_pulled',
        message: `Model ${OLLAMA_MODEL} pulled successfully`,
        context: { model: OLLAMA_MODEL },
      });
    } else {
      logger.debug({
        operation: 'llm_parser_model_available',
        message: `Model ${OLLAMA_MODEL} is already available`,
        context: { model: OLLAMA_MODEL },
      });
    }

    return true;
  } catch (error) {
    logger.error({
      operation: 'llm_parser_model_error',
      message: 'Failed to ensure model availability',
      context: { model: OLLAMA_MODEL },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return false;
  }
}
