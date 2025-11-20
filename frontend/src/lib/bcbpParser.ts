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

  // Conditional data (if present)
  airlineNumericCode?: string;
  documentSerialNumber?: string;
  selecteeIndicator?: string;
  internationalDocumentationVerification?: string;
  marketingCarrier?: string;
  frequentFlyerNumber?: string;

  // Raw data for debugging
  raw: string;
}

/**
 * Parse IATA BCBP barcode data
 */
export function parseBCBP(barcodeData: string): BoardingPassData | null {
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

    // Convert Julian date to actual date
    const dateOfFlight = julianDateToDate(julianDate);

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
  const currentYear = new Date().getFullYear();

  // Create date from day of year
  const date = new Date(currentYear, 0); // January 1st
  date.setDate(dayOfYear);

  // If date is more than 30 days in the past, assume next year
  const today = new Date();
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < -30) {
    date.setFullYear(currentYear + 1);
  }

  return date.toISOString().split('T')[0]; // Return YYYY-MM-DD
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
