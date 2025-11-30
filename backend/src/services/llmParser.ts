import axios from 'axios';
import { ParsedBooking } from './bookingParser';

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
  console.log('[LLM Parser] Starting email parsing with Ollama');
  console.log('[LLM Parser] Model:', OLLAMA_MODEL);
  console.log('[LLM Parser] URL:', OLLAMA_URL);

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
    console.log('[LLM Parser] Sending request to Ollama...');
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
    console.log(`[LLM Parser] Response received in ${duration}ms`);

    // Parse the JSON response
    let parsedData: any;
    try {
      // Remove any markdown code blocks if present
      let jsonText = response.data.response.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      parsedData = JSON.parse(jsonText);
      console.log('[LLM Parser] Successfully parsed LLM response:', parsedData);
    } catch (parseError) {
      console.error('[LLM Parser] Failed to parse LLM response:', response.data.response);
      throw new Error('LLM returned invalid JSON');
    }

    // Ensure we have an array
    const flightsArray = Array.isArray(parsedData) ? parsedData : [parsedData];
    console.log('[LLM Parser] Found', flightsArray.length, 'flight(s)');

    // Build ParsedBooking results for each flight
    const results: ParsedBooking[] = flightsArray.map((flight: any, index: number) => {
      const missing: string[] = [];
      if (!flight.flightNumber) missing.push('flightNumber');
      if (!flight.departureCode) missing.push('departureCode');
      if (!flight.arrivalCode) missing.push('arrivalCode');
      if (!flight.departureTime) missing.push('departureTime');
      if (!flight.arrivalTime) missing.push('arrivalTime');

      const result: ParsedBooking = {
        airline: flight.flightNumber?.slice(0, 2) || undefined,
        flightNumber: flight.flightNumber || undefined,
        departureCode: flight.departureCode || undefined,
        arrivalCode: flight.arrivalCode || undefined,
        departureTime: flight.departureTime || undefined,
        arrivalTime: flight.arrivalTime || undefined,
        pnr: flight.pnr || undefined,
        seat: flight.seat || undefined,
        terminal: flight.terminal || undefined,
        gate: flight.gate || undefined,
        price: flight.price || undefined,
        currency: flight.currency || undefined,
        missing,
      };

      console.log(`[LLM Parser] Flight ${index + 1}/${flightsArray.length}:`, result);
      return result;
    });

    console.log('[LLM Parser] Final results:', results.length, 'flight(s) extracted');
    return results;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        console.error('[LLM Parser] Cannot connect to Ollama. Is it running?');
        throw new Error('Ollama service is not available');
      }
      console.error('[LLM Parser] Axios error:', error.message);
      throw new Error(`Ollama API error: ${error.message}`);
    }
    console.error('[LLM Parser] Unexpected error:', error);
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
    console.log(`[LLM Parser] Checking if model ${OLLAMA_MODEL} is available...`);
    const response = await axios.get(`${OLLAMA_URL}/api/tags`);

    const models = response.data.models || [];
    const modelExists = models.some((m: any) => m.name === OLLAMA_MODEL);

    if (!modelExists) {
      console.log(`[LLM Parser] Model ${OLLAMA_MODEL} not found. Pulling...`);
      console.log('[LLM Parser] This may take several minutes on first run.');

      // Pull the model (this can take a while)
      await axios.post(`${OLLAMA_URL}/api/pull`, {
        name: OLLAMA_MODEL,
        stream: false,
      }, {
        timeout: 600000, // 10 minute timeout for downloading
      });

      console.log(`[LLM Parser] Model ${OLLAMA_MODEL} pulled successfully`);
    } else {
      console.log(`[LLM Parser] Model ${OLLAMA_MODEL} is already available`);
    }

    return true;
  } catch (error) {
    console.error('[LLM Parser] Failed to ensure model availability:', error);
    return false;
  }
}
