/**
 * Parser Registry
 *
 * Central registry for managing boarding pass parsers.
 * Implements Singleton pattern to ensure single instance across the application.
 * Parsers are executed in priority order until one succeeds.
 */

import { BoardingPassParser } from "./IParser";
import { BoardingPassData } from "../bcbpParser";
import { logger } from "../logger";

/**
 * Parser Registry Singleton
 */
class ParserRegistry {
  private static instance: ParserRegistry;
  private parsers: BoardingPassParser[] = [];
  private sorted: boolean = false;

  private constructor() {
    // Private constructor for Singleton pattern
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ParserRegistry {
    if (!ParserRegistry.instance) {
      ParserRegistry.instance = new ParserRegistry();
    }
    return ParserRegistry.instance;
  }

  /**
   * Register a parser
   * @param parser - Parser to register
   */
  register(parser: BoardingPassParser): void {
    // Check if parser with same name already exists
    const existingIndex = this.parsers.findIndex((p) => p.name === parser.name);
    if (existingIndex >= 0) {
      logger.warn(`[Parser Registry] Parser "${parser.name}" already registered, replacing...`);
      this.parsers[existingIndex] = parser;
    } else {
      this.parsers.push(parser);
    }
    this.sorted = false; // Mark as unsorted, will sort on next getParsers() call
  }

  /**
   * Unregister a parser by name
   * @param name - Parser name to unregister
   */
  unregister(name: string): void {
    const index = this.parsers.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.parsers.splice(index, 1);
      this.sorted = false;
    }
  }

  /**
   * Get all registered parsers, sorted by priority
   * @returns Array of parsers sorted by priority (lowest first)
   */
  getParsers(): BoardingPassParser[] {
    if (!this.sorted) {
      this.parsers.sort((a, b) => a.priority - b.priority);
      this.sorted = true;
    }
    return [...this.parsers]; // Return copy to prevent external modifications
  }

  /**
   * Parse barcode data using registered parsers
   * Tries parsers in priority order until one succeeds.
   *
   * @param barcodeData - Raw barcode data string
   * @returns Parsed boarding pass data, or null if all parsers failed
   */
  parse(barcodeData: string): BoardingPassData | null {
    if (!barcodeData || barcodeData.trim().length === 0) {
      logger.debug("[Parser Registry] Empty barcode data provided");
      return null;
    }

    const parsers = this.getParsers();
    logger.debug(
      `[Parser Registry] Attempting to parse with ${parsers.length} registered parser(s)`
    );

    for (const parser of parsers) {
      try {
        // Quick check first
        if (!parser.canParse(barcodeData)) {
          logger.debug(
            `[Parser Registry] Parser "${parser.name}" skipped (canParse returned false)`
          );
          continue;
        }

        logger.debug(
          `[Parser Registry] Trying parser "${parser.name}" (priority: ${parser.priority})`
        );
        const result = parser.parse(barcodeData);

        if (result) {
          logger.debug(`[Parser Registry] Parser "${parser.name}" succeeded`);
          return result;
        } else {
          logger.debug(`[Parser Registry] Parser "${parser.name}" returned null`);
        }
      } catch (error) {
        logger.error(`[Parser Registry] Parser "${parser.name}" threw error:`, error);
        // Continue to next parser
        continue;
      }
    }

    logger.error("[Parser Registry] All parsers failed to parse barcode data");
    return null;
  }

  /**
   * Clear all registered parsers
   */
  clear(): void {
    this.parsers = [];
    this.sorted = false;
  }

  /**
   * Get count of registered parsers
   */
  getCount(): number {
    return this.parsers.length;
  }
}

export default ParserRegistry;
