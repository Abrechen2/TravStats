import { getParserConfig, getAvailableProviders } from '../services/parsers/factory';
import { getRegexParser } from '../services/parsers/text/regexParser';
import { getManualParser } from '../services/parsers/vision/manualParser';

describe('Parser Factory', () => {
  describe('getParserConfig', () => {
    it('should return default config when no user settings provided', async () => {
      const config = await getParserConfig();

      expect(config).toBeDefined();
      expect(config.visionProvider).toBe('auto');
      expect(config.textProvider).toBe('auto');
      expect(config.visionFallbacks).toBeDefined();
      expect(config.textFallbacks).toBeDefined();
    });

    it('should use user settings when provided', async () => {
      const config = await getParserConfig({
        preferredVisionParser: 'ollama',
        preferredTextParser: 'regex',
        openaiApiKey: 'test-key',
      });

      expect(config.visionProvider).toBe('ollama');
      expect(config.textProvider).toBe('regex');
      expect(config.openaiApiKey).toBe('test-key');
    });

    it('should merge admin settings with user settings', async () => {
      const config = await getParserConfig(
        {
          preferredVisionParser: 'auto',
        },
        {
          globalOpenaiApiKey: 'admin-key',
        }
      );

      expect(config.openaiApiKey).toBe('admin-key');
    });

    it('should prioritize user settings over admin settings', async () => {
      const config = await getParserConfig(
        {
          preferredVisionParser: 'ollama',
          openaiApiKey: 'user-key',
        },
        {
          globalOpenaiApiKey: 'admin-key',
        }
      );

      expect(config.openaiApiKey).toBe('user-key');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return available providers', async () => {
      const config = await getParserConfig();
      const providers = await getAvailableProviders(config);

      expect(providers).toBeDefined();
      expect(providers.vision).toBeDefined();
      expect(providers.text).toBeDefined();
      expect(Array.isArray(providers.vision)).toBe(true);
      expect(Array.isArray(providers.text)).toBe(true);
    });

    it('should include always-available parsers', async () => {
      const config = await getParserConfig();
      const providers = await getAvailableProviders(config);

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













