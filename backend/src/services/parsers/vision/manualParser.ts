import { IVisionParser, ProviderAvailability, VisionProvider } from '../types';
import { ParsedBooking } from '../../bookingParser';
import { getTesseractParser } from './tesseractParser';
import logger from '../../../utils/logger';

/**
 * Manual Vision Parser
 *
 * Ultimate fallback that extracts text via OCR and returns it
 * with empty/incomplete fields for manual user correction.
 *
 * Pros:
 * - Always works (never fails completely)
 * - Free and local
 * - User has full control
 *
 * Cons:
 * - Requires manual data entry
 * - Time-consuming for users
 * - Only useful as last resort
 */
export class ManualParser implements IVisionParser {
  readonly provider: VisionProvider = 'manual';
  private tesseractParser = getTesseractParser();

  async checkAvailability(): Promise<ProviderAvailability> {
    // Manual parser is always available
    return {
      available: true,
      metadata: {
        provider: 'manual',
        description: 'OCR text extraction + manual field entry',
        cost: 'free',
      },
    };
  }

  async parseImage(imageBase64: string): Promise<ParsedBooking> {
    logger.info('[Manual Parser] Extracting text for manual review');

    try {
      // Use Tesseract to extract text
      const tesseractResult = await this.tesseractParser.parseImage(imageBase64);

      logger.info('[Manual Parser] OCR extraction complete - returning for manual review');

      // Return result with all fields potentially empty
      // The user will fill them manually in the review modal
      return {
        ...tesseractResult,
        // Ensure missing array contains all critical fields if not found
        missing: [
          ...(tesseractResult.missing || []),
          ...(!tesseractResult.flightNumber ? ['flightNumber'] : []),
          ...(!tesseractResult.departureCode ? ['departureCode'] : []),
          ...(!tesseractResult.arrivalCode ? ['arrivalCode'] : []),
          ...(!tesseractResult.departureTime ? ['departureTime'] : []),
        ].filter((v, i, a) => a.indexOf(v) === i), // Remove duplicates
      };
    } catch (error) {
      logger.warn({ error }, '[Manual Parser] OCR extraction failed - returning empty fields');

      // Even if OCR fails, return an empty structure for manual entry
      return {
        airline: undefined,
        flightNumber: undefined,
        departureCode: undefined,
        arrivalCode: undefined,
        departureTime: undefined,
        arrivalTime: undefined,
        pnr: undefined,
        seat: undefined,
        terminal: undefined,
        gate: undefined,
        price: undefined,
        currency: undefined,
        aircraft: undefined,
        seatClass: undefined,
        bookingReference: undefined,
        ticketNumber: undefined,
        boardingGroup: undefined,
        taxes: undefined,
        fees: undefined,
        missing: ['flightNumber', 'departureCode', 'arrivalCode', 'departureTime', 'arrivalTime'],
      };
    }
  }
}

// Singleton instance
let instance: ManualParser | null = null;

export function getManualParser(): ManualParser {
  if (!instance) {
    instance = new ManualParser();
  }
  return instance;
}
