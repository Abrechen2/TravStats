/**
 * URL-based Boarding Pass Parser
 * 
 * Handles URL-based boarding passes (web boarding passes).
 * URLs typically need to be fetched and decoded, so this parser
 * mainly detects URLs and marks them for backend processing.
 */

import { BoardingPassParser } from './IParser';
import { BoardingPassData } from '../bcbpParser';
import { logger } from '../logger';

/**
 * URL-based Boarding Pass Parser
 * 
 * Priority: 20 (after Standard BCBP, before fallback)
 */
export class URLParser implements BoardingPassParser {
  name = 'url';
  priority = 20;
  category: 'url' = 'url';

  canParse(barcodeData: string): boolean {
    // Check if it's a URL
    return barcodeData.trim().startsWith('http://') || barcodeData.trim().startsWith('https://');
  }

  parse(barcodeData: string): BoardingPassData | null {
    try {
      if (!this.canParse(barcodeData)) {
        return null;
      }

      // URL-based boarding passes typically need backend processing
      // to fetch and decode the actual boarding pass data.
      // For now, we log and return null - this would require backend integration.
      
      logger.warn('[URL Parser] URL-based boarding pass detected, but parsing not yet implemented:', barcodeData.substring(0, 100));
      
      // TODO: In the future, this could:
      // 1. Extract URL parameters
      // 2. Make backend request to fetch boarding pass data
      // 3. Parse the fetched data
      
      return null;
    } catch (error) {
      logger.error('[URL Parser] Error parsing URL boarding pass:', error);
      return null;
    }
  }
}



