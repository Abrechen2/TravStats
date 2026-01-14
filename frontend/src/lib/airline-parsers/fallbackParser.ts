/**
 * Fallback Boarding Pass Parser
 * 
 * Intelligent RegEx-based parser that extracts flight data from any text format.
 * This is a catch-all parser that runs last and tries to extract what it can.
 */

import { BoardingPassParser } from './IParser';
import { BoardingPassData } from '../bcbpParser';
import { logger } from '../logger';

function getAirlineName(iataCode: string): string {
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

  return airlines[iataCode.trim()] || iataCode.trim();
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
 * Fallback Boarding Pass Parser
 * 
 * Priority: 100 (always last - catch-all for unknown formats)
 */
export class FallbackParser implements BoardingPassParser {
  name = 'fallback';
  priority = 100;
  category: 'fallback' = 'fallback';

  canParse(barcodeData: string): boolean {
    // Fallback parser can potentially parse anything
    // We return true if there's any reasonable data
    return barcodeData.trim().length > 10;
  }

  parse(barcodeData: string): BoardingPassData | null {
    try {
      logger.debug('[Fallback Parser] Attempting fallback parsing on:', barcodeData.substring(0, 100));

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
        if (validAirportCodes.includes(code)) return true;
        if (knownNonAirports.includes(code)) return false;
        return code[0] !== code[1] || code[1] !== code[2];
      });

      if (likelyAirports.length >= 2) {
        extracted.departureAirport = likelyAirports[0];
        extracted.arrivalAirport = likelyAirports[1];
        logger.debug('[Fallback Parser] Airports found:', extracted.departureAirport, '→', extracted.arrivalAirport);
      } else if (airports.length >= 2) {
        extracted.departureAirport = airports[0];
        extracted.arrivalAirport = airports[1];
        logger.debug('[Fallback Parser] Airports found (fallback):', extracted.departureAirport, '→', extracted.arrivalAirport);
      }

      // Pattern 2: Flight number (airline code + digits)
      const flightPattern = /\b([A-Z]{2})(\d{1,4})\b/g;
      const flights = [...barcodeData.matchAll(flightPattern)];
      if (flights.length > 0) {
        extracted.operatingCarrierDesignator = flights[0][1];
        extracted.flightNumber = flights[0][2];
        extracted.airlineName = getAirlineName(flights[0][1]);
        logger.debug('[Fallback Parser] Flight found:', extracted.operatingCarrierDesignator + extracted.flightNumber);
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
        const year = '20' + match1[3];
        if (month) {
          extracted.dateOfFlight = `${year}-${month}-${day}`;
          logger.debug('[Fallback Parser] Date found:', match1[0], '→', extracted.dateOfFlight);
        }
      }

      // Try YYYY-MM-DD or YYYYMMDD
      if (!extracted.dateOfFlight) {
        const datePattern2 = /(\d{4})-?(\d{2})-?(\d{2})/;
        const match2 = barcodeData.match(datePattern2);
        if (match2) {
          extracted.dateOfFlight = `${match2[1]}-${match2[2]}-${match2[3]}`;
          logger.debug('[Fallback Parser] Date found:', match2[0]);
        }
      }

      // Try DD.MM.YYYY
      if (!extracted.dateOfFlight) {
        const datePattern3 = /(\d{2})\.(\d{2})\.(\d{4})/;
        const match3 = barcodeData.match(datePattern3);
        if (match3) {
          extracted.dateOfFlight = `${match3[3]}-${match3[2]}-${match3[1]}`;
          logger.debug('[Fallback Parser] Date found:', match3[0]);
        }
      }

      // Pattern 4: Passenger name (LASTNAME/FIRSTNAME or similar)
      const namePattern = /([A-Z]{2,})\s*[\/,]\s*([A-Z]{2,})/;
      const nameMatch = barcodeData.match(namePattern);
      if (nameMatch) {
        extracted.passengerName = `${nameMatch[1]}/${nameMatch[2]}`;
        logger.debug('[Fallback Parser] Passenger name found:', extracted.passengerName);
      }

      // Pattern 5: Seat number (e.g., 12A, 3F, 16F)
      const seatPattern = /\b(\d{1,2}[A-F])\b/;
      const seatMatch = barcodeData.match(seatPattern);
      if (seatMatch) {
        extracted.seatNumber = seatMatch[1];
        logger.debug('[Fallback Parser] Seat found:', extracted.seatNumber);
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
          logger.debug('[Fallback Parser] Class found:', keyword);
          break;
        }
      }

      // Pattern 7: Time patterns (HH:MM)
      const timePattern = /\b(\d{2}):(\d{2})\b/g;
      const times = [...barcodeData.matchAll(timePattern)];
      if (times.length > 0) {
        logger.debug('[Fallback Parser] Times found:', times.map(t => t[0]).join(', '));
      }

      // Validation: We need at minimum departure and arrival airports
      if (!extracted.departureAirport || !extracted.arrivalAirport) {
        logger.warn('[Fallback Parser] Fallback parsing failed: missing required airports');
        return null;
      }

      // Fill in defaults for required fields
      if (!extracted.dateOfFlight) {
        extracted.dateOfFlight = new Date().toISOString().split('T')[0];
      }

      logger.debug('[Fallback Parser] Fallback parsing successful!');
      return extracted as BoardingPassData;
    } catch (error) {
      logger.error('[Fallback Parser] Fallback parsing error:', error);
      return null;
    }
  }
}



