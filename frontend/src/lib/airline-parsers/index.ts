/**
 * Airline Parsers Index
 * 
 * Auto-registers all parsers and exports the parseBCBP function.
 * This is the main entry point for the parser system.
 */

import ParserRegistry from './parserRegistry';
import { StandardBCBPParser } from './standardBCBPParser';
import { URLParser } from './urlParser';
import { FallbackParser } from './fallbackParser';
import { BoardingPassData } from '../bcbpParser';

// Get singleton registry instance
const registry = ParserRegistry.getInstance();

// Register all parsers (in priority order)
registry.register(new StandardBCBPParser());
registry.register(new URLParser());
registry.register(new FallbackParser()); // Always last

/**
 * Parse boarding pass barcode data using registered parsers
 * 
 * This function tries all registered parsers in priority order until one succeeds.
 * 
 * @param barcodeData - Raw barcode data string
 * @returns Parsed boarding pass data, or null if all parsers failed
 */
export function parseBCBP(barcodeData: string): BoardingPassData | null {
  return registry.parse(barcodeData);
}

/**
 * Get the parser registry instance (for advanced usage)
 */
export function getParserRegistry(): ParserRegistry {
  return registry;
}



