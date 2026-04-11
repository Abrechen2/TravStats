import { getParserConfig, getAvailableProviders } from '../services/parsers/factory';
import { getRegexParser } from '../services/parsers/text/regexParser';
import { getManualParser } from '../services/parsers/vision/manualParser';

describe('Parser Factory', () => {
  describe('getParserConfig', () => {
    it('should return default config when no user settings provided', async () => {
      const config = await getParserConfig();

      expect(config).toBeDefined();
      // Current implementation always returns fixed providers regardless of args.
      expect(config.visionProvider).toBe('tesseract');
      expect(config.textProvider).toBe('regex');
      expect(config.visionFallbacks).toBeDefined();
      expect(config.textFallbacks).toBeDefined();
    });

    it('should return fixed providers even when user settings are supplied', async () => {
      // User-level preferred-parser overrides were removed in a refactor;
      // config now always resolves to tesseract/regex.
      const config = await getParserConfig({
        preferredVisionParser: 'ollama',
        preferredTextParser: 'regex',
      });

      expect(config.visionProvider).toBe('tesseract');
      expect(config.textProvider).toBe('regex');
    });

    it('should accept admin settings argument without crashing', async () => {
      const config = await getParserConfig(
        { preferredVisionParser: 'auto' },
        { globalOpenaiApiKey: 'admin-key' }
      );

      // Admin settings arg is currently ignored by the config factory,
      // but must not break the call.
      expect(config.visionProvider).toBe('tesseract');
      expect(config.textProvider).toBe('regex');
    });

    it('should pass through userId into the resulting config', async () => {
      const config = await getParserConfig(undefined, undefined, 'user-42');

      expect(config.userId).toBe('user-42');
      expect(config.visionProvider).toBe('tesseract');
      expect(config.textProvider).toBe('regex');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return available providers', async () => {
      const providers = await getAvailableProviders();

      expect(providers).toBeDefined();
      expect(providers.vision).toBeDefined();
      expect(providers.text).toBeDefined();
      expect(Array.isArray(providers.vision)).toBe(true);
      expect(Array.isArray(providers.text)).toBe(true);
    });

    it('should include always-available parsers', async () => {
      const providers = await getAvailableProviders();

      // Manual parser should always be available
      const manualProvider = providers.vision.find(p => p.provider === 'manual');
      expect(manualProvider).toBeDefined();
      expect(manualProvider?.availability.available).toBe(true);

      // Regex parser should always be available
      const regexProvider = providers.text.find(p => p.provider === 'regex');
      expect(regexProvider).toBeDefined();
      expect(regexProvider?.availability.available).toBe(true);
    });
  });

  describe('Parser Instances', () => {
    it('should create regex parser instance', () => {
      const parser = getRegexParser();
      expect(parser).toBeDefined();
      expect(parser.provider).toBe('regex');
    });

    it('should create manual parser instance', () => {
      const parser = getManualParser();
      expect(parser).toBeDefined();
      expect(parser.provider).toBe('manual');
    });
  });
});
