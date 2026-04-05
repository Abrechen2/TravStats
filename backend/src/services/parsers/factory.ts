import {
  VisionProvider,
  TextProvider,
  ProviderAvailability,
} from './types';
import { checkProviderAvailability } from './config';
import { getVisionParserInstance, getTextParserInstance } from './providers';

/**
 * Parser Factory
 *
 * Thin orchestrator — delegates to focused sub-modules.
 * Re-exports public API for backward compatibility.
 */

// Re-exports for backward compatibility
export { getParserConfig, clearAvailabilityCache } from './config';
export { getVisionParser, getTextParser } from './providers';
export { parseBoardingPass } from './boardingPass';
export { parseEmail } from './email';

/**
 * Get all available providers (for settings UI)
 */
export async function getAvailableProviders(): Promise<{
  vision: Array<{ provider: VisionProvider; availability: ProviderAvailability }>;
  text: Array<{ provider: TextProvider; availability: ProviderAvailability }>;
}> {
  const allVisionProviders: VisionProvider[] = ['tesseract', 'manual'];
  const allTextProviders: TextProvider[] = ['regex'];

  const visionResults = await Promise.all(
    allVisionProviders.map(async (provider) => {
      const parser = getVisionParserInstance(provider);
      const availability = await checkProviderAvailability(parser);
      return { provider, availability };
    })
  );

  const textResults = await Promise.all(
    allTextProviders.map(async (provider) => {
      const parser = getTextParserInstance(provider);
      const availability = await checkProviderAvailability(parser);
      return { provider, availability };
    })
  );

  return {
    vision: visionResults,
    text: textResults,
  };
}
