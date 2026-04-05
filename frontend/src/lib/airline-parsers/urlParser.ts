/**
 * URL-based Boarding Pass Parser
 *
 * Handles URL-based boarding passes (web boarding passes).
 * URLs typically need to be fetched and decoded, so this parser
 * mainly detects URLs and marks them for backend processing.
 */

import { BoardingPassParser } from "./IParser";
import { BoardingPassData } from "./bcbpHelpers";
import { logger } from "../logger";

/**
 * URL-based Boarding Pass Parser
 *
 * Priority: 20 (after Standard BCBP, before fallback)
 */
export class URLParser implements BoardingPassParser {
  name = "url";
  priority = 20;
  category = "url" as const;

  canParse(barcodeData: string): boolean {
    // Check if it's a URL
    return barcodeData.trim().startsWith("http://") || barcodeData.trim().startsWith("https://");
  }

  parse(barcodeData: string): BoardingPassData | null {
    try {
      if (!this.canParse(barcodeData)) {
        return null;
      }

      // URL-based boarding passes require fetching and decoding external content.
      // This is intentionally unsupported on the client side — backend integration
      // would be needed to proxy and parse the URL content safely.
      logger.warn(
        "[URL Parser] URL-based boarding pass detected, client-side parsing not supported:",
        barcodeData.substring(0, 100)
      );

      return null;
    } catch (error) {
      logger.error("[URL Parser] Error parsing URL boarding pass:", error);
      return null;
    }
  }
}
