/**
 * Standard IATA BCBP Parser
 * 
 * Parses the standard IATA Bar Coded Boarding Pass (BCBP) format.
 * This format is used by most legacy carriers worldwide.
 */

import { BoardingPassParser } from './IParser';
import { BoardingPassData } from '../bcbpParser';
import { logger } from '../logger';

/**
 * Convert Julian date (day of year) to ISO date string
 */
function julianDateToDate(julianDate: string): string {
  const dayOfYear = parseInt(julianDate, 10);
  logger.debug('[Standard BCBP Parser] Julian day conversion: Input day of year =', dayOfYear);

  let year = new Date().getFullYear();
  logger.debug('[Standard BCBP Parser] Current year:', year);

  const date = new Date(Date.UTC(year, 0, dayOfYear));
  logger.debug('[Standard BCBP Parser] Calculated date (before year adjustment):', date.toISOString().split('T')[0]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  logger.debug('[Standard BCBP Parser] Days difference from today:', diffDays);

  let adjustedYear = year;
  if (diffDays > 300) {
    adjustedYear = year - 1;
    logger.debug('[Standard BCBP Parser] Date is >300 days in future, assuming PREVIOUS year');
  }

  const finalDate = new Date(Date.UTC(adjustedYear, 0, dayOfYear));
  const result = finalDate.toISOString().split('T')[0];
  logger.debug('[Standard BCBP Parser] Final converted date:', result);
  return result;
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

/**
 * Standard IATA BCBP Parser
 * 
 * Priority: 10 (high priority - this covers ~80% of all boarding passes)
 */
export class StandardBCBPParser implements BoardingPassParser {
  name = 'standard-bcbp';
  priority = 10;
  category: 'core' = 'core';

  canParse(barcodeData: string): boolean {
    // Quick check: BCBP format starts with 'M' for mandatory items
    return barcodeData.startsWith('M');
  }

  parse(barcodeData: string): BoardingPassData | null {
    try {
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
      logger.debug('[Standard BCBP Parser] Julian date from barcode:', julianDate);

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

      // Parse conditional items if available
      let gate: string | undefined;
      let terminal: string | undefined;
      let boardingTime: string | undefined;

      try {
        logger.debug(`[Standard BCBP Parser] Current position after mandatory: ${pos}`);

        // Skip padding spaces
        while (pos < barcodeData.length && barcodeData.charAt(pos) === ' ') {
          pos++;
        }

        // Beginning of variable size field (1 char) - version number/marker
        if (pos < barcodeData.length) {
          pos += 1; // Skip version byte

          // Field size of structured message - Conditional (2 chars, hex)
          if (pos + 1 < barcodeData.length) {
            const lengthHex = barcodeData.substring(pos, pos + 2);
            logger.debug('[Standard BCBP Parser] Conditional length (raw HEX string):', JSON.stringify(lengthHex));

            let conditionalLength = 0;
            try {
              conditionalLength = parseInt(lengthHex.trim(), 16);
              logger.debug('[Standard BCBP Parser] Conditional items length (parsed as hex):', conditionalLength);
            } catch {
              logger.warn('[Standard BCBP Parser] Failed to parse conditional length as hex');
            }

            pos += 2;

            if (conditionalLength > 0 && conditionalLength < 200 && pos + conditionalLength <= barcodeData.length) {
              // Conditional data exists but we skip parsing airline-specific data
              logger.debug('[Standard BCBP Parser] Conditional section present - airline-specific data will be extracted via OCR');
              pos += conditionalLength;
            } else if (conditionalLength === 0) {
              logger.debug('[Standard BCBP Parser] No conditional data present');
            }
          }
        }
      } catch (error) {
        logger.warn('[Standard BCBP Parser] Failed to parse conditional items (non-critical):', error);
      }

      // Convert Julian date to actual date
      const dateOfFlight = julianDateToDate(julianDate);
      logger.debug('[Standard BCBP Parser] Converted to date:', dateOfFlight);
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
      logger.error('[Standard BCBP Parser] Failed to parse BCBP:', error);
      return null;
    }
  }
}

