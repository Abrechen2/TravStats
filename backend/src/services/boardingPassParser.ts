import { getParserConfig, parseBoardingPass as parseBoardingPassFromFactory } from './parsers/factory';
import type { ParsedBooking } from './bookingParser';

interface BoardingPassParseResult {
  flight: ParsedBooking;
  provider: string;
  fallbackUsed: boolean;
}

/**
 * Backwards-compatible wrapper for boarding pass parsing.
 *
 * Old call site: parseBoardingPass(imageBase64, useApiEnrichment?)
 * New implementation delegates to the parser factory and returns
 * the first parsed flight as `flight` to match existing tests.
 */
export async function parseBoardingPass(
  imageBase64: string,
  _useApiEnrichment: boolean = false
): Promise<BoardingPassParseResult> {
  const config = getParserConfig();
  const result = await parseBoardingPassFromFactory(imageBase64, config);

  const flight = result.flights[0];

  return {
    flight,
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
  };
}

