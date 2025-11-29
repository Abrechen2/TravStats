/**
 * IATA Bar Coded Boarding Pass (BCBP) Parser
 *
 * Parses the standardized IATA barcode format found on boarding passes.
 * Format: https://www.iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf
 */

export interface BoardingPassData {
  formatCode: string;
  numberOfLegs: number;
  passengerName: string;
  electronicTicketIndicator: string;

  // Per-leg data (we focus on first leg)
  operatingCarrierPNR: string;
  departureAirport: string;
  arrivalAirport: string;
  operatingCarrierDesignator: string;
  flightNumber: string;
  dateOfFlight: string; // JULIAN DATE (DDD = day of year)
  compartmentCode: string;
  seatNumber: string;
  checkInSequenceNumber: string;
  passengerStatus: string;
  seatClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  airlineName?: string;

  // Conditional data (if present)
  airlineNumericCode?: string;
  documentSerialNumber?: string;
  selecteeIndicator?: string;
  internationalDocumentationVerification?: string;
  marketingCarrier?: string;
  frequentFlyerNumber?: string;

  // Extended data from conditional/security sections
  gate?: string;
  terminal?: string;
  boardingTime?: string; // HH:MM format

  // Raw data for debugging
  raw: string;
}

// Import airline-specific parsers
import { parseRyanairBoardingPass } from './airline-parsers/ryanairParser';

/**
 * Enhanced parser that tries multiple boarding pass formats
 *
 * ARCHITECTURE: One scanner, multiple parsers (Fallback Chain Pattern)
 * This allows us to support any airline without duplicating scanner code.
 */
export function parseBCBP(barcodeData: string): BoardingPassData | null {
  console.log('🔍 BCBP PARSER: Raw barcode data:', barcodeData);
  console.log('🔍 BCBP PARSER: Length:', barcodeData.length, 'chars');

  // Try 1: Standard IATA BCBP format (most common)
  const bcbpResult = parseBCBPStandard(barcodeData);
  if (bcbpResult) {
    console.log('✅ BCBP PARSER: Standard IATA format successful');
    console.log('📅 Parsed date:', bcbpResult.dateOfFlight);
    console.log('✈️ Airline:', bcbpResult.operatingCarrierDesignator, '-', bcbpResult.airlineName);
    console.log('🔢 Flight:', bcbpResult.flightNumber);
    return bcbpResult;
  }

  // Try 2: Airline-specific formats (proprietary encodings)
  const ryanairResult = parseRyanairBoardingPass(barcodeData);
  if (ryanairResult) {
    console.log('✅ BCBP PARSER: Ryanair format successful');
    return ryanairResult;
  }

  // TODO: Add more airline-specific parsers here:
  // const easyJetResult = parseEasyJetBoardingPass(barcodeData);
  // if (easyJetResult) return easyJetResult;

  // Try 3: URL-based formats (e.g., Lufthansa, Ryanair web boarding passes)
  const urlResult = parseURLBoardingPass(barcodeData);
  if (urlResult) {
    console.log('✅ BCBP PARSER: URL format successful');
    return urlResult;
  }

  // Try 4: Intelligent fallback - extract what we can from any text
  const fallbackResult = parseFallbackBoardingPass(barcodeData);
  if (fallbackResult) {
    console.log('✅ BCBP PARSER: Fallback parsing successful');
    console.log('📅 Parsed date:', fallbackResult.dateOfFlight);
    return fallbackResult;
  }

  console.error('❌ BCBP PARSER: All parsing methods failed');
  return null;
}

/**
 * Parse standard IATA BCBP barcode data
 */
function parseBCBPStandard(barcodeData: string): BoardingPassData | null {
  try {
    // BCBP format starts with 'M' for mandatory items
    if (!barcodeData.startsWith('M')) {
      return null;
    }

    let pos = 1;

    // Format code (1 char) - '1' for single leg, 'M' for multi-leg
    const formatCode = barcodeData.charAt(pos);
    pos += 1;

    // Number of legs (only in multi-leg format 'M', not in format '1')
    let numberOfLegs = 1;
    if (formatCode === 'M') {
      numberOfLegs = parseInt(barcodeData.charAt(pos), 10);
      pos += 1;
    }

    // Passenger name (FIXED LENGTH: 20 chars, right-padded with spaces)
    // Format: LASTNAME/FIRSTNAME followed by spaces
    const passengerName = barcodeData.substring(pos, pos + 20).trim();
    pos += 20;

    // Electronic ticket indicator (1 char) - 'E' for e-ticket
    const electronicTicketIndicator = barcodeData.charAt(pos);
    pos += 1;

    // Operating carrier PNR code (7 chars)
    const operatingCarrierPNR = barcodeData.substring(pos, pos + 7).trim();
    pos += 7;

    // Departure airport (3 chars - IATA code)
    const departureAirport = barcodeData.substring(pos, pos + 3);
    pos += 3;

    // Arrival airport (3 chars - IATA code)
    const arrivalAirport = barcodeData.substring(pos, pos + 3);
    pos += 3;

    // Operating carrier designator (3 chars - airline code)
    const operatingCarrierDesignator = barcodeData.substring(pos, pos + 3).trim();
    pos += 3;

    // Flight number (5 chars, right-padded with spaces)
    const flightNumber = barcodeData.substring(pos, pos + 5).trim();
    pos += 5;

    // Date of flight (3 chars - Julian date, day of year)
    const julianDate = barcodeData.substring(pos, pos + 3);
    pos += 3;
    console.log('📅 Julian date from barcode:', julianDate);

    // Compartment code (1 char) - Y=Economy, J=Business, F=First
    const compartmentCode = barcodeData.charAt(pos);
    pos += 1;

    // Seat number (4 chars)
    const seatNumber = barcodeData.substring(pos, pos + 4).trim();
    pos += 4;

    // Check-in sequence number (5 chars)
    const checkInSequenceNumber = barcodeData.substring(pos, pos + 5).trim();
    pos += 5;

    // Passenger status (1 char)
    const passengerStatus = barcodeData.charAt(pos);
    pos += 1;

    // ===== END OF MANDATORY ITEMS (60 bytes) =====

    // Parse conditional items if available (contains gate, terminal, boarding time, etc.)
    let gate: string | undefined;
    let terminal: string | undefined;
    let boardingTime: string | undefined;

    try {
      // Beginning of variable size field (1 char) - should be at position 60
      if (pos < barcodeData.length) {
        pos += 1; // Skip version number byte

        // Field size of structured message - Conditional (2 chars, hex)
        if (pos + 1 < barcodeData.length) {
          const conditionalLength = parseInt(barcodeData.substring(pos, pos + 2), 16);
          pos += 2;
          console.log('📦 Conditional items length:', conditionalLength);

          if (conditionalLength > 0 && pos + conditionalLength <= barcodeData.length) {
            const conditionalData = barcodeData.substring(pos, pos + conditionalLength);
            console.log('📦 Conditional data:', conditionalData);

            // Parse standard conditional fields (first ~40 bytes are standardized)
            let cPos = 0;

            // Airline Numeric Code (3 chars) - Optional
            if (cPos + 3 <= conditionalData.length) {
              cPos += 3;
            }

            // Document Form/Serial Number (13 chars total: 1 char type + 12 chars number) - Optional
            if (cPos + 13 <= conditionalData.length) {
              cPos += 13;
            }

            // Selectee indicator (1 char) - Optional
            if (cPos + 1 <= conditionalData.length) {
              cPos += 1;
            }

            // International documentation verification (1 char) - Optional
            if (cPos + 1 <= conditionalData.length) {
              cPos += 1;
            }

            // Marketing carrier designator (3 chars) - Optional
            if (cPos + 3 <= conditionalData.length) {
              cPos += 3;
            }

            // Frequent flyer airline designator (3 chars) - Optional
            if (cPos + 3 <= conditionalData.length) {
              cPos += 3;
            }

            // Frequent flyer number (16 chars) - Optional
            if (cPos + 16 <= conditionalData.length) {
              cPos += 16;
            }

            // ID/AD indicator (1 char) - Optional
            if (cPos + 1 <= conditionalData.length) {
              cPos += 1;
            }

            // Free baggage allowance (3 chars) - Optional
            if (cPos + 3 <= conditionalData.length) {
              cPos += 3;
            }

            // Fast Track (1 char) - Optional
            if (cPos + 1 <= conditionalData.length) {
              cPos += 1;
            }

            // ==== AIRLINE-SPECIFIC DATA (Individual Airline Use) ====
            // The remaining bytes contain airline-specific data
            // Common fields: Gate, Terminal, Boarding Time, Sequence Number
            const airlineData = conditionalData.substring(cPos);
            console.log('🏷️  Airline-specific data:', airlineData);

            // Try to extract gate and terminal from airline-specific section
            // Many airlines put gate/terminal in a structured format
            // Common patterns: "B11T1" (Gate B11, Terminal 1), "A12" (Gate A12)
            const gateMatch = airlineData.match(/([A-Z]\d{1,3})/);
            if (gateMatch) {
              gate = gateMatch[1];
              console.log('🚪 Extracted gate:', gate);
            }

            // Try to extract terminal (often T followed by digit or single letter)
            const terminalMatch = airlineData.match(/T(\d|[A-Z])/);
            if (terminalMatch) {
              terminal = `T${terminalMatch[1]}`;
              console.log('🏢 Extracted terminal:', terminal);
            }

            // Try to extract boarding time (HH:MM format or HHMM)
            const timeMatch = airlineData.match(/(\d{2})[:.]?(\d{2})/);
            if (timeMatch && parseInt(timeMatch[1]) < 24 && parseInt(timeMatch[2]) < 60) {
              boardingTime = `${timeMatch[1]}:${timeMatch[2]}`;
              console.log('⏰ Extracted boarding time:', boardingTime);
            }

            pos += conditionalLength;
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse conditional items (non-critical):', error);
      // Continue anyway - conditional items are optional
    }

    // Convert Julian date to actual date
    const dateOfFlight = julianDateToDate(julianDate);
    console.log('📅 Converted to date:', dateOfFlight);
    const seatClass = mapCompartmentToSeatClass(compartmentCode);
    const airlineName = getAirlineName(operatingCarrierDesignator);

    return {
      formatCode,
      numberOfLegs,
      passengerName,
      electronicTicketIndicator,
      operatingCarrierPNR,
      departureAirport,
      arrivalAirport,
      operatingCarrierDesignator,
      flightNumber,
      dateOfFlight,
      compartmentCode,
      seatNumber,
      checkInSequenceNumber,
      passengerStatus,
      seatClass,
      airlineName,
      gate,
      terminal,
      boardingTime,
      raw: barcodeData,
    };
  } catch (error) {
    console.error('Failed to parse BCBP:', error);
    return null;
  }
}

/**
 * Convert Julian date (day of year) to ISO date string
 * Assumes current year unless date is in the past
 */
function julianDateToDate(julianDate: string): string {
  const dayOfYear = parseInt(julianDate, 10);
  console.log('📅 Julian day conversion: Input day of year =', dayOfYear);

  let currentYear = new Date().getFullYear();
  console.log('📅 Current year:', currentYear);

  // Create date from day of year using UTC to avoid timezone issues
  // new Date(year, month, day) where month=0 is January
  // day can overflow: new Date(2025, 0, 322) = 322nd day from January 1st
  const date = new Date(Date.UTC(currentYear, 0, dayOfYear));

  console.log('📅 Calculated date (before year adjustment):', date.toISOString().split('T')[0]);

  // If date is more than 30 days in the past, assume next year
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  console.log('📅 Days difference from today:', diffDays);

  if (diffDays < -30) {
    console.log('📅 Date is >30 days in past, assuming next year');
    const nextYearDate = new Date(Date.UTC(currentYear + 1, 0, dayOfYear));
    const result = nextYearDate.toISOString().split('T')[0];
    console.log('📅 Final converted date:', result);
    return result;
  }

  const result = date.toISOString().split('T')[0];
  console.log('📅 Final converted date:', result);
  return result; // Return YYYY-MM-DD
}

function mapCompartmentToSeatClass(
  code: string
): 'economy' | 'premium_economy' | 'business' | 'first' {
  const c = code.toUpperCase();
  if ('FAP'.includes(c)) return 'first';
  if ('CJDZ'.includes(c)) return 'business';
  if ('WPE'.includes(c)) return 'premium_economy';
  return 'economy';
}

/**
 * Get airline name from IATA code (common airlines)
 */
export function getAirlineName(iataCode: string): string {
  const airlines: Record<string, string> = {
    'LH': 'Lufthansa',
    'EN': 'AirDolomiti',
    'BA': 'British Airways',
    'AF': 'Air France',
    'KL': 'KLM',
    'LX': 'Swiss',
    'OS': 'Austrian Airlines',
    'SN': 'Brussels Airlines',
    'SK': 'SAS Scandinavian Airlines',
    'AY': 'Finnair',
    'TP': 'TAP Air Portugal',
    'IB': 'Iberia',
    'VY': 'Vueling',
    'FR': 'Ryanair',
    'U2': 'easyJet',
    'W6': 'Wizz Air',
    'EW': 'Eurowings',
    'UA': 'United Airlines',
    'AA': 'American Airlines',
    'DL': 'Delta Air Lines',
    'WN': 'Southwest Airlines',
    'B6': 'JetBlue',
    'AC': 'Air Canada',
    'EK': 'Emirates',
    'QR': 'Qatar Airways',
    'TK': 'Turkish Airlines',
    'SQ': 'Singapore Airlines',
    'CX': 'Cathay Pacific',
    'NH': 'ANA',
    'JL': 'Japan Airlines',
  };

  return airlines[iataCode] || iataCode;
}

/**
 * Parse URL-based boarding passes (e.g., https://lh.de/bp/ABC123)
 */
function parseURLBoardingPass(barcodeData: string): BoardingPassData | null {
  try {
    // Check if it's a URL
    if (!barcodeData.startsWith('http')) {
      return null;
    }

    // Extract data from URL
    // Common patterns:
    // - Lufthansa: https://lh.de/bp/...
    // - Ryanair: https://www.ryanair.com/...
    // - British Airways: https://www.britishairways.com/...

    // For now, return null - URLs need to be fetched/decoded
    // This would require backend integration
    console.warn('URL-based boarding pass detected, but parsing not yet implemented:', barcodeData);
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Intelligent fallback parser - extracts flight data from any text using regex patterns
 */
function parseFallbackBoardingPass(barcodeData: string): BoardingPassData | null {
  try {
    console.log('🔍 Attempting fallback parsing on:', barcodeData);

    // Extract what we can using regex patterns
    const extracted: Partial<BoardingPassData> = {
      raw: barcodeData,
      formatCode: 'FALLBACK',
      numberOfLegs: 1,
      passengerName: '',
      electronicTicketIndicator: 'E',
      operatingCarrierPNR: '',
      departureAirport: '',
      arrivalAirport: '',
      operatingCarrierDesignator: '',
      flightNumber: '',
      dateOfFlight: '',
      compartmentCode: 'Y',
      seatNumber: '',
      checkInSequenceNumber: '',
      passengerStatus: '0',
    };

    // Pattern 1: IATA airport codes (3 uppercase letters)
    const airportPattern = /\b([A-Z]{3})\b/g;
    const airports = [...barcodeData.matchAll(airportPattern)].map(m => m[1]);

    // Common false positives to filter out (not airports)
    const knownNonAirports = ['SEC', 'DRP', 'SIT', 'FTL', 'MRS', 'STR', 'LHS', 'THE', 'AND', 'FOR'];

    // Known valid airport codes (to override false positive filter)
    const validAirportCodes = ['LUX', 'MUC', 'FRA', 'LHR', 'JFK', 'LAX', 'ORD', 'DFW', 'CDG', 'AMS',
                                'BER', 'VIE', 'ZRH', 'GVA', 'BCN', 'MAD', 'FCO', 'MXP', 'CPH', 'OSL',
                                'ARN', 'HEL', 'WAW', 'PRG', 'BUD', 'ATH', 'IST', 'DXB', 'DOH', 'SIN'];

    const likelyAirports = airports.filter(code => {
      // Include if it's a known airport code
      if (validAirportCodes.includes(code)) return true;

      // Exclude known non-airports
      if (knownNonAirports.includes(code)) return false;

      // Basic validation: not all same letter
      return code[0] !== code[1] || code[1] !== code[2];
    });

    if (likelyAirports.length >= 2) {
      extracted.departureAirport = likelyAirports[0];
      extracted.arrivalAirport = likelyAirports[1];
      console.log('✓ Airports found:', extracted.departureAirport, '→', extracted.arrivalAirport);
    } else if (airports.length >= 2) {
      // Fallback: just take first two 3-letter codes
      extracted.departureAirport = airports[0];
      extracted.arrivalAirport = airports[1];
      console.log('✓ Airports found (fallback):', extracted.departureAirport, '→', extracted.arrivalAirport);
    }

    // Pattern 2: Flight number (airline code + digits)
    const flightPattern = /\b([A-Z]{2})(\d{1,4})\b/g;
    const flights = [...barcodeData.matchAll(flightPattern)];
    if (flights.length > 0) {
      extracted.operatingCarrierDesignator = flights[0][1];
      extracted.flightNumber = flights[0][2];
      extracted.airlineName = getAirlineName(flights[0][1]);
      console.log('✓ Flight found:', extracted.operatingCarrierDesignator + extracted.flightNumber);
    }

    // Pattern 3: Date patterns (DDMMMYY, YYYYMMDD, DD.MM.YYYY, etc.)
    const monthMap: Record<string, string> = {
      'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
      'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
      'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    // Try DDMMMYY format (e.g., 20NOV25)
    const datePattern1 = /(\d{2})([A-Z]{3})(\d{2})/;
    const match1 = barcodeData.match(datePattern1);
    if (match1) {
      const day = match1[1];
      const month = monthMap[match1[2]];
      const year = '20' + match1[3]; // Assume 20xx
      if (month) {
        extracted.dateOfFlight = `${year}-${month}-${day}`;
        console.log('✓ Date found:', match1[0], '→', extracted.dateOfFlight);
      }
    }

    // Try YYYY-MM-DD or YYYYMMDD
    if (!extracted.dateOfFlight) {
      const datePattern2 = /(\d{4})-?(\d{2})-?(\d{2})/;
      const match2 = barcodeData.match(datePattern2);
      if (match2) {
        extracted.dateOfFlight = `${match2[1]}-${match2[2]}-${match2[3]}`;
        console.log('✓ Date found:', match2[0]);
      }
    }

    // Try DD.MM.YYYY
    if (!extracted.dateOfFlight) {
      const datePattern3 = /(\d{2})\.(\d{2})\.(\d{4})/;
      const match3 = barcodeData.match(datePattern3);
      if (match3) {
        extracted.dateOfFlight = `${match3[3]}-${match3[2]}-${match3[1]}`;
        console.log('✓ Date found:', match3[0]);
      }
    }

    // Pattern 4: Passenger name (LASTNAME/FIRSTNAME or similar)
    const namePattern = /([A-Z]{2,})\s*[\/,]\s*([A-Z]{2,})/;
    const nameMatch = barcodeData.match(namePattern);
    if (nameMatch) {
      extracted.passengerName = `${nameMatch[1]}/${nameMatch[2]}`;
      console.log('✓ Passenger name found:', extracted.passengerName);
    }

    // Pattern 5: Seat number (e.g., 12A, 3F, 16F)
    const seatPattern = /\b(\d{1,2}[A-F])\b/;
    const seatMatch = barcodeData.match(seatPattern);
    if (seatMatch) {
      extracted.seatNumber = seatMatch[1];
      console.log('✓ Seat found:', extracted.seatNumber);
    }

    // Pattern 6: Class indicators
    const classKeywords = {
      'BUSINESS': 'J',
      'FIRST': 'F',
      'ECONOMY': 'Y',
      'PREMIUM': 'W',
    };

    for (const [keyword, code] of Object.entries(classKeywords)) {
      if (barcodeData.includes(keyword)) {
        extracted.compartmentCode = code;
        extracted.seatClass = mapCompartmentToSeatClass(code);
        console.log('✓ Class found:', keyword);
        break;
      }
    }

    // Pattern 7: Time patterns (HH:MM)
    const timePattern = /\b(\d{2}):(\d{2})\b/g;
    const times = [...barcodeData.matchAll(timePattern)];
    if (times.length > 0) {
      console.log('✓ Times found:', times.map(t => t[0]).join(', '));
    }

    // Validation: We need at minimum departure and arrival airports
    if (!extracted.departureAirport || !extracted.arrivalAirport) {
      console.warn('⚠️ Fallback parsing failed: missing required airports');
      return null;
    }

    // Fill in defaults for required fields
    if (!extracted.dateOfFlight) {
      extracted.dateOfFlight = new Date().toISOString().split('T')[0];
    }

    console.log('✅ Fallback parsing successful!', extracted);

    return extracted as BoardingPassData;
  } catch (error) {
    console.error('❌ Fallback parsing error:', error);
    return null;
  }
}
