/**
 * Ryanair-specific boarding pass parser
 *
 * Ryanair uses a proprietary QR code format that differs from IATA BCBP
 * Pattern: Usually contains "RYANAIR" or "FR" airline code prominently
 */

import { BoardingPassData } from '../bcbpParser';

/**
 * Parse Ryanair-specific boarding pass format
 */
export function parseRyanairBoardingPass(barcodeData: string): BoardingPassData | null {
  try {
    console.log('🔍 Attempting Ryanair-specific parsing');

    // Check if it's likely a Ryanair boarding pass
    if (!barcodeData.includes('RYANAIR') && !barcodeData.includes('FR')) {
      return null;
    }

    // Extract data using Ryanair-specific patterns
    const extracted: Partial<BoardingPassData> = {
      raw: barcodeData,
      formatCode: 'RYANAIR',
      numberOfLegs: 1,
      passengerName: '',
      electronicTicketIndicator: 'E',
      operatingCarrierPNR: '',
      departureAirport: '',
      arrivalAirport: '',
      operatingCarrierDesignator: 'FR',
      flightNumber: '',
      dateOfFlight: '',
      compartmentCode: 'Y', // Ryanair only has economy
      seatNumber: '',
      checkInSequenceNumber: '',
      passengerStatus: '0',
      airlineName: 'Ryanair',
    };

    // Ryanair-specific patterns
    // Pattern 1: Flight number (FR + 4 digits)
    const flightPattern = /FR\s*(\d{4})/i;
    const flightMatch = barcodeData.match(flightPattern);
    if (flightMatch) {
      extracted.flightNumber = flightMatch[1];
      console.log('✓ Ryanair flight found: FR' + extracted.flightNumber);
    }

    // Pattern 2: Airports (usually in format "XXX-YYY" or "XXX to YYY")
    const routePattern = /([A-Z]{3})\s*(?:-|to|→)\s*([A-Z]{3})/i;
    const routeMatch = barcodeData.match(routePattern);
    if (routeMatch) {
      extracted.departureAirport = routeMatch[1].toUpperCase();
      extracted.arrivalAirport = routeMatch[2].toUpperCase();
      console.log('✓ Route found:', extracted.departureAirport, '→', extracted.arrivalAirport);
    }

    // Pattern 3: Seat number (Ryanair format: row + letter)
    const seatPattern = /(?:SEAT|Seat|seat)\s*[:=]?\s*(\d{1,2}[A-F])/i;
    const seatMatch = barcodeData.match(seatPattern);
    if (seatMatch) {
      extracted.seatNumber = seatMatch[1].toUpperCase();
      console.log('✓ Seat found:', extracted.seatNumber);
    }

    // Pattern 4: Passenger name (usually "NAME: LASTNAME/FIRSTNAME")
    const namePattern = /(?:NAME|Name|name)\s*[:=]?\s*([A-Z]+)\s*[\/,]\s*([A-Z]+)/;
    const nameMatch = barcodeData.match(namePattern);
    if (nameMatch) {
      extracted.passengerName = `${nameMatch[1]}/${nameMatch[2]}`;
      console.log('✓ Passenger name found:', extracted.passengerName);
    }

    // Pattern 5: Date (Ryanair often uses DD MMM YYYY format)
    const datePattern = /(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i;
    const dateMatch = barcodeData.match(datePattern);
    if (dateMatch) {
      const monthMap: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
      };
      const day = dateMatch[1].padStart(2, '0');
      const month = monthMap[dateMatch[2].toUpperCase()];
      const year = dateMatch[3];
      extracted.dateOfFlight = `${year}-${month}-${day}`;
      console.log('✓ Date found:', extracted.dateOfFlight);
    }

    // Pattern 6: Booking reference (Ryanair uses 6-character alphanumeric)
    const pnrPattern = /(?:BOOKING|Booking|PNR|Ref)\s*[:=]?\s*([A-Z0-9]{6})/i;
    const pnrMatch = barcodeData.match(pnrPattern);
    if (pnrMatch) {
      extracted.operatingCarrierPNR = pnrMatch[1].toUpperCase();
      console.log('✓ PNR found:', extracted.operatingCarrierPNR);
    }

    // Validation: We need at minimum airports
    if (!extracted.departureAirport || !extracted.arrivalAirport) {
      console.warn('⚠️ Ryanair parsing failed: missing airports');
      return null;
    }

    // Fill in defaults
    if (!extracted.dateOfFlight) {
      extracted.dateOfFlight = new Date().toISOString().split('T')[0];
    }

    console.log('✅ Ryanair boarding pass parsed successfully!', extracted);
    return extracted as BoardingPassData;

  } catch (error) {
    console.error('❌ Ryanair parsing error:', error);
    return null;
  }
}
