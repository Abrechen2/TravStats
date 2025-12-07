import axios from 'axios';
import { ParsedBooking } from './bookingParser';
import logger from '../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// Airline-specific patterns for better recognition
const AIRLINE_PATTERNS = {
  lufthansa: ['lufthansa', 'lh', 'swiss', 'lx', 'austrian', 'os'],
  ryanair: ['ryanair', 'fr'],
  easyjet: ['easyjet', 'u2'],
  eurowings: ['eurowings', 'ew'],
  // Add more airlines...
};

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

/**
 * Enhanced LLM parser with better prompt engineering and few-shot examples
 */
export async function parseEmailWithLLM(
  subject: string,
  text: string,
  html?: string
): Promise<ParsedBooking[]> {
  logger.debug({
    operation: 'enhanced_llm_parser_start',
    message: 'Starting email parsing with Ollama',
    context: { model: OLLAMA_MODEL },
  });

  // Clean the text
  const cleanText = text
    .replace(/\0/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 6000); // Increased limit for better context

  // Enhanced prompt with few-shot examples
  const prompt = `You are an expert flight booking email parser with deep knowledge of airline booking formats.

TASK: Extract ALL flights from the email below. Each flight is a separate leg of the journey.

CRITICAL RULES:
1. Extract EACH flight separately (outbound, return, connections)
2. IATA codes are ALWAYS 3 uppercase letters (e.g., MUC, FRA, LUX)
3. Flight numbers format: 2-letter airline code + 1-4 digits (e.g., LH103, FR8234)
4. Dates in ISO 8601 format: YYYY-MM-DDTHH:MM (e.g., 2025-11-18T11:00)
5. If a field is not found, use null (not empty string)

FEW-SHOT EXAMPLES:

Example 1 - Lufthansa Round Trip with Full Details:
Email: "Ihre Buchung 9RFAA7: München (MUC) nach Luxemburg (LUX) am 18.11.2025 um 11:00 mit LH103, Airbus A321, Economy Light, Sitz 26F, Ankunft 12:55, Rückflug am 20.11.2025 um 09:30 mit LH442, Ticketnummer: 2202236084346, Preis: 513.47 EUR (Steuern: 45.67 EUR, Gebühren: 12.30 EUR)"
Output:
[
  {
    "flightNumber": "LH103",
    "departureCode": "MUC",
    "arrivalCode": "LUX",
    "departureTime": "2025-11-18T11:00",
    "arrivalTime": "2025-11-18T12:55",
    "pnr": "9RFAA7",
    "bookingReference": "9RFAA7",
    "seat": "26F",
    "aircraft": "Airbus A321",
    "seatClass": "Economy Light",
    "ticketNumber": "2202236084346",
    "boardingGroup": null,
    "price": "513.47",
    "currency": "EUR",
    "taxes": "45.67",
    "fees": "12.30",
    "terminal": null,
    "gate": null
  },
  {
    "flightNumber": "LH442",
    "departureCode": "LUX",
    "arrivalCode": "MUC",
    "departureTime": "2025-11-20T09:30",
    "arrivalTime": null,
    "pnr": "9RFAA7",
    "bookingReference": "9RFAA7",
    "seat": null,
    "aircraft": null,
    "seatClass": null,
    "ticketNumber": "2202236084346",
    "boardingGroup": null,
    "price": null,
    "currency": null,
    "taxes": null,
    "fees": null,
    "terminal": null,
    "gate": null
  }
]

Example 2 - Ryanair with connection:
Email: "Booking FR1234 from Berlin (BER) to London (STN) on 2025-12-01 at 08:15, connecting flight FR5678 from London (STN) to Dublin (DUB) at 11:30"
Output:
[
  {
    "flightNumber": "FR1234",
    "departureCode": "BER",
    "arrivalCode": "STN",
    "departureTime": "2025-12-01T08:15",
    "arrivalTime": null,
    "pnr": null,
    "bookingReference": null,
    "seat": null,
    "aircraft": null,
    "seatClass": null,
    "ticketNumber": null,
    "boardingGroup": null,
    "price": null,
    "currency": null,
    "taxes": null,
    "fees": null,
    "terminal": null,
    "gate": null
  },
  {
    "flightNumber": "FR5678",
    "departureCode": "STN",
    "arrivalCode": "DUB",
    "departureTime": "2025-12-01T11:30",
    "arrivalTime": null,
    "pnr": null,
    "bookingReference": null,
    "seat": null,
    "aircraft": null,
    "seatClass": null,
    "ticketNumber": null,
    "boardingGroup": null,
    "price": null,
    "currency": null,
    "taxes": null,
    "fees": null,
    "terminal": null,
    "gate": null
  }
]

NOW PARSE THIS EMAIL:

SUBJECT: ${subject}

BODY: ${cleanText}

OUTPUT FORMAT: Return ONLY a valid JSON array. No explanations, no markdown, just the JSON array.

EXTRACT THESE FIELDS FOR EACH FLIGHT:
- flightNumber: string (airline code + number, e.g., "LH103")
- departureCode: 3-letter IATA code (e.g., "MUC")
- arrivalCode: 3-letter IATA code (e.g., "LUX")
- departureTime: ISO 8601 datetime (e.g., "2025-11-18T11:00")
- arrivalTime: ISO 8601 datetime or null
- pnr: booking reference or null
- seat: seat number (e.g., "26F") or null
- terminal: terminal (e.g., "2") or null
- gate: gate (e.g., "B12") or null
- price: numeric string (e.g., "513.47") or null
- currency: ISO currency code (e.g., "EUR") or null

NEW FIELDS (extract if available):
- aircraft: aircraft type (e.g., "Airbus A321", "Boeing 777-300ER") or null
- seatClass: cabin class (e.g., "Economy Light", "Business", "First") or null
- bookingReference: booking code/PNR (usually 6 alphanumeric, e.g., "9RFAA7") or null
- ticketNumber: ticket number (typically 13 digits, e.g., "2202236084346") or null
- boardingGroup: boarding group/zone (e.g., "1", "A", "Zone 3") or null
- taxes: tax amount as numeric string (e.g., "45.67") or null
- fees: fee amount as numeric string (e.g., "12.30") or null

EXTRACTION TIPS:
- Aircraft: Look for "Airbus", "Boeing", "Embraer", "A320", "B777", "Flugzeugtyp"
- Seat Class: Look for "Economy", "Business", "First", "Premium", "Buchungsklasse"
- Booking Reference: Usually near "Buchungscode:", "PNR:", "Buchung:"
- Ticket Number: Usually near "Ticketnummer:", "E-Ticket:", 13 digits
- Taxes/Fees: Only extract if itemized (labeled "Steuern", "Gebühren", "Taxes", "Fees")

JSON OUTPUT:`;

  try {
    logger.debug({
      operation: 'enhanced_llm_parser_request',
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
          temperature: 0.05, // Very low for consistent extraction
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1,
          num_predict: 2000, // Allow longer responses for multiple flights
        },
      },
      {
        timeout: 90000, // 90 second timeout for complex emails
      }
    );

    const duration = Date.now() - startTime;
    logger.debug({
      operation: 'enhanced_llm_parser_response',
      message: 'Response received from Ollama',
      performance: { duration },
    });

    // Parse the JSON response
    let parsedData: any;
    try {
      let jsonText = response.data.response.trim();

      // Remove markdown code blocks
      if (jsonText.includes('```')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      // Remove any text before first [ or {
      const jsonStart = Math.min(
        jsonText.indexOf('[') >= 0 ? jsonText.indexOf('[') : Infinity,
        jsonText.indexOf('{') >= 0 ? jsonText.indexOf('{') : Infinity
      );
      if (jsonStart > 0 && jsonStart !== Infinity) {
        jsonText = jsonText.substring(jsonStart);
      }

      // Remove any text after last ] or }
      const jsonEnd = Math.max(
        jsonText.lastIndexOf(']'),
        jsonText.lastIndexOf('}')
      );
      if (jsonEnd > 0) {
        jsonText = jsonText.substring(0, jsonEnd + 1);
      }

      parsedData = JSON.parse(jsonText);
      logger.debug({
        operation: 'enhanced_llm_parser_parse',
        message: 'Successfully parsed LLM response',
        context: { 
          flightCount: Array.isArray(parsedData) 
            ? parsedData.length 
            : (parsedData && typeof parsedData === 'object' ? 1 : 0) 
        },
      });
    } catch (parseError) {
      logger.error({
        operation: 'enhanced_llm_parser_parse_error',
        message: 'Failed to parse LLM response',
        context: { responsePreview: response.data.response.substring(0, 500) },
        error: {
          message: parseError instanceof Error ? parseError.message : 'Unknown error',
          stack: parseError instanceof Error ? parseError.stack : undefined,
        },
      });
      throw new Error('LLM returned invalid JSON');
    }

    // Ensure we have an array - handle various JSON structures
    let flightsArray: any[] = [];

    if (Array.isArray(parsedData)) {
      // Direct array: [flight1, flight2]
      flightsArray = parsedData;
    } else if (parsedData && typeof parsedData === 'object') {
      // Check for nested arrays with common keys
      const possibleKeys = ['flights', 'flightNumbers', 'data', 'results', 'items'];
      let foundArray = false;

      for (const key of possibleKeys) {
        if (Array.isArray(parsedData[key])) {
          flightsArray = parsedData[key];
          foundArray = true;
          logger.debug({
            operation: 'enhanced_llm_parser_nested_array',
            message: `Found nested array at key: ${key}`,
            context: { key },
          });
          break;
        }
      }

      if (!foundArray) {
        // Single flight object: {flightNumber: ...}
        flightsArray = [parsedData];
      }
    }

    logger.debug({
      operation: 'enhanced_llm_parser_flights_found',
      message: `Found ${flightsArray.length} flight(s)`,
      context: { flightCount: flightsArray.length },
    });

    // Validate and build ParsedBooking results
    const results: ParsedBooking[] = flightsArray
      .filter((flight: any) => {
        // Filter out invalid flights
        return flight.flightNumber && flight.departureCode && flight.arrivalCode;
      })
      .map((flight: any, index: number) => {
        const missing: string[] = [];
        if (!flight.flightNumber) missing.push('flightNumber');
        if (!flight.departureCode) missing.push('departureCode');
        if (!flight.arrivalCode) missing.push('arrivalCode');
        if (!flight.departureTime) missing.push('departureTime');
        if (!flight.arrivalTime) missing.push('arrivalTime');

        // Clean and validate IATA codes
        const cleanIATA = (code: string | null | undefined): string | undefined => {
          if (!code) return undefined;
          const cleaned = code.toUpperCase().trim();
          return /^[A-Z]{3}$/.test(cleaned) ? cleaned : undefined;
        };

        const result: ParsedBooking = {
          airline: flight.flightNumber?.slice(0, 2).toUpperCase() || undefined,
          flightNumber: flight.flightNumber?.toUpperCase().replace(/\s+/g, '') || undefined,
          departureCode: cleanIATA(flight.departureCode),
          arrivalCode: cleanIATA(flight.arrivalCode),
          departureTime: flight.departureTime || undefined,
          arrivalTime: flight.arrivalTime || undefined,
          pnr: flight.pnr?.toUpperCase() || flight.bookingReference?.toUpperCase() || undefined,
          seat: flight.seat?.toUpperCase() || undefined,
          terminal: flight.terminal || undefined,
          gate: flight.gate?.toUpperCase() || undefined,
          price: flight.price ? String(flight.price) : undefined,
          currency: flight.currency?.toUpperCase() || undefined,
          // NEW FIELDS: Enhanced email parsing
          aircraft: flight.aircraft || undefined,
          seatClass: flight.seatClass || undefined,
          bookingReference: flight.bookingReference?.toUpperCase() || flight.pnr?.toUpperCase() || undefined,
          ticketNumber: flight.ticketNumber || undefined,
          boardingGroup: flight.boardingGroup || undefined,
          taxes: flight.taxes ? String(flight.taxes) : undefined,
          fees: flight.fees ? String(flight.fees) : undefined,
          missing,
        };

        logger.debug({
          operation: 'enhanced_llm_parser_flight_processed',
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
      operation: 'enhanced_llm_parser_complete',
      message: `Successfully extracted ${results.length} valid flight(s)`,
      context: { flightCount: results.length },
    });
    return results;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        logger.error({
          operation: 'enhanced_llm_parser_connection_error',
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
        operation: 'enhanced_llm_parser_axios_error',
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
      operation: 'enhanced_llm_parser_unexpected_error',
      message: 'Unexpected error in enhanced LLM parser',
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
 * Get recommended models for flight parsing
 */
export function getRecommendedModels(): Array<{
  name: string;
  size: string;
  pros: string[];
  cons: string[];
}> {
  return [
    {
      name: 'qwen2.5:7b',
      size: '4.7GB',
      pros: ['Excellent for structured data extraction', 'Fast', 'Good JSON output'],
      cons: ['Larger download'],
    },
    {
      name: 'mistral:7b',
      size: '4.1GB',
      pros: ['Very accurate', 'Good multilingual support', 'Reliable JSON'],
      cons: ['Slower than smaller models'],
    },
    {
      name: 'llama3.2:3b',
      size: '2.0GB',
      pros: ['Fast', 'Small size', 'Good baseline'],
      cons: ['Less accurate than 7b models'],
    },
    {
      name: 'gemma2:9b',
      size: '5.4GB',
      pros: ['Excellent instruction following', 'Very good JSON output'],
      cons: ['Larger size', 'Slightly slower'],
    },
  ];
}

/**
 * Ensure the required model is pulled/downloaded
 */
export async function ensureModelAvailable(): Promise<boolean> {
  try {
    logger.debug({
      operation: 'enhanced_llm_parser_check_model',
      message: `Checking if model ${OLLAMA_MODEL} is available`,
      context: { model: OLLAMA_MODEL },
    });
    const response = await axios.get(`${OLLAMA_URL}/api/tags`);

    const models = response.data.models || [];
    const modelExists = models.some((m: any) => m.name === OLLAMA_MODEL);

    if (!modelExists) {
      logger.info({
        operation: 'enhanced_llm_parser_pull_model',
        message: `Model ${OLLAMA_MODEL} not found, pulling...`,
        context: { model: OLLAMA_MODEL },
      });

      await axios.post(`${OLLAMA_URL}/api/pull`, {
        name: OLLAMA_MODEL,
        stream: false,
      }, {
        timeout: 600000, // 10 minute timeout
      });

      logger.info({
        operation: 'enhanced_llm_parser_model_pulled',
        message: `Model ${OLLAMA_MODEL} pulled successfully`,
        context: { model: OLLAMA_MODEL },
      });
    } else {
      logger.debug({
        operation: 'enhanced_llm_parser_model_available',
        message: `Model ${OLLAMA_MODEL} is already available`,
        context: { model: OLLAMA_MODEL },
      });
    }

    return true;
  } catch (error) {
    logger.error({
      operation: 'enhanced_llm_parser_model_error',
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
