/**
 * Boarding Pass Parser Interface
 * 
 * Defines the contract for all boarding pass parsers in the system.
 * Parsers are executed in priority order until one succeeds.
 */

import { BoardingPassData } from '../bcbpParser';

/**
 * Parser category for organization and logging
 */
export type ParserCategory = 'core' | 'low-cost' | 'legacy' | 'regional' | 'url' | 'fallback';

/**
 * Boarding Pass Parser Interface
 * 
 * All parsers must implement this interface to be registered in the parser chain.
 */
export interface BoardingPassParser {
  /**
   * Unique name/identifier for this parser (e.g., "standard-bcbp", "ryanair")
   */
  name: string;

  /**
   * Parser priority (lower number = higher priority, executed first)
   * - 0-9: Special format checks
   * - 10-19: Standard IATA BCBP
   * - 20-49: Airline-specific parsers
   * - 50-99: URL-based formats
   * - 100+: Fallback parsers (always last)
   */
  priority: number;

  /**
   * Optional IATA airline codes this parser handles (e.g., ["FR"] for Ryanair)
   * Used for documentation and potentially optimized routing
   */
  airlineCodes?: string[];

  /**
   * Optional category for organization
   */
  category?: ParserCategory;

  /**
   * Quick check if this parser can potentially handle the barcode data.
   * Should be fast (no expensive operations) - used to skip parsers that definitely won't work.
   * 
   * @param barcodeData - Raw barcode data string
   * @returns true if parser might be able to parse this data
   */
  canParse(barcodeData: string): boolean;

  /**
   * Parse the barcode data into structured BoardingPassData.
   * 
   * @param barcodeData - Raw barcode data string
   * @returns Parsed boarding pass data, or null if parsing failed
   */
  parse(barcodeData: string): BoardingPassData | null;
}



