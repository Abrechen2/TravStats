import { useState, useEffect } from 'react';
import { parseApi, settingsApi } from '../../lib/api';
import InlineHelp from '../Help/InlineHelp';
import { useTranslation } from '../../hooks/useTranslation';

const parserProviderOptions = {
  vision: [
    { value: 'auto', label: '🤖 Auto (Recommended)', description: 'Automatically selects best available parser' },
    { value: 'ollama', label: '🖥️ Ollama Vision', description: 'Local AI (free, needs GPU)' },
    { value: 'openai', label: '☁️ OpenAI GPT-4', description: 'Cloud AI (~$0.01-0.05/image)' },
    { value: 'claude', label: '☁️ Claude 3.5', description: 'Cloud AI (~$0.01-0.03/image)' },
    { value: 'tesseract', label: '📝 Tesseract OCR', description: 'Local OCR (free, no GPU needed)' },
    { value: 'manual', label: '✋ Manual', description: 'OCR + manual entry' },
  ],
  text: [
    { value: 'auto', label: '🤖 Auto (Recommended)', description: 'Automatically selects best available parser' },
    { value: 'ollama', label: '🖥️ Ollama', description: 'Local AI (free, qwen2.5:7b)' },
    { value: 'openai', label: '☁️ OpenAI GPT-4', description: 'Cloud AI (~$0.002-0.01/email)' },
    { value: 'claude', label: '☁️ Claude 3.5', description: 'Cloud AI (~$0.003-0.015/email)' },
    { value: 'regex', label: '🔤 Regex', description: 'Pattern matching (free fallback)' },
  ],
};

interface ParserConfigurationProps {
  className?: string;
}

export default function ParserConfiguration({ className = '' }: ParserConfigurationProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [providers, setProviders] = useState<any>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [saving, setSaving] = useState(false);

  // Parser settings (in real app, would come from settingsStore or API)
  const [settings, setSettings] = useState({
    preferredVisionParser: 'auto',
    preferredTextParser: 'auto',
    openaiApiKey: '',
    claudeApiKey: '',
  });

  // Load parser settings and available providers
  useEffect(() => {
    const loadData = async () => {
      try {
        const [providersData, settingsData] = await Promise.all([
          parseApi.getProviders(),
          settingsApi.getParserSettings(),
        ]);
        setProviders(providersData);
        setSettings({
          preferredVisionParser: settingsData.preferredVisionParser || 'auto',
          preferredTextParser: settingsData.preferredTextParser || 'auto',
          openaiApiKey: settingsData.openaiApiKey || '',
          claudeApiKey: settingsData.claudeApiKey || '',
        });
      } catch (error) {
        console.error('Failed to load parser data:', error);
      } finally {
        setLoadingProviders(false);
      }
    };
    loadData();
  }, []);

  const getProviderStatus = (providerType: 'vision' | 'text', providerName: string) => {
    if (!providers) return null;
    const provider = providers[providerType]?.find((p: any) => p.provider === providerName);
    return provider?.availability;
  };

  const renderProviderStatus = (providerType: 'vision' | 'text', providerName: string) => {
    if (loadingProviders) {
      return <span className="text-xs text-gray-400">{t('common:buttons.loading')}</span>;
    }

    const status = getProviderStatus(providerType, providerName);
    if (!status) return null;

    if (status.available) {
      return (
        <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>{t('settings:parser.available')}</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" title={status.reason}>
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span>{t('settings:parser.unavailable')}</span>
      </div>
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.updateParserSettings({
        preferredVisionParser: settings.preferredVisionParser,
        preferredTextParser: settings.preferredTextParser,
        openaiApiKey: settings.openaiApiKey || undefined,
        claudeApiKey: settings.claudeApiKey || undefined,
      });
      alert(t('settings:parser.saved'));
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      const errorMessage = error.response?.data?.error || t('settings:parser.saveFailed');
      alert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`card space-y-6 ${className}`}>
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">{t('settings:parser.title')}</h2>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? t('common:buttons.saving') : t('settings:parser.saveSettings')}
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('settings:parser.description')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vision Parser (Boarding Pass) */}
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-1">{t('settings:parser.vision.title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings:parser.vision.description')}</p>
          </div>

          <div>
            <label className="label">{t('settings:parser.preferred')}</label>
            <select
              value={settings.preferredVisionParser}
              onChange={(e) => setSettings({ ...settings, preferredVisionParser: e.target.value })}
              className="input"
            >
              {parserProviderOptions.vision.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {parserProviderOptions.vision.find((o) => o.value === settings.preferredVisionParser)?.description}
            </p>
          </div>

          {/* Provider Status List */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Provider Status:</p>
            {parserProviderOptions.vision.map((option) => (
              <div key={option.value} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{option.label}</span>
                {renderProviderStatus('vision', option.value)}
              </div>
            ))}
          </div>
        </div>

        {/* Text Parser (Email) */}
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-1">{t('settings:parser.text.title')}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings:parser.text.description')}</p>
          </div>

          <div>
            <label className="label">{t('settings:parser.preferred')}</label>
            <select
              value={settings.preferredTextParser}
              onChange={(e) => setSettings({ ...settings, preferredTextParser: e.target.value })}
              className="input"
            >
              {parserProviderOptions.text.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {parserProviderOptions.text.find((o) => o.value === settings.preferredTextParser)?.description}
            </p>
          </div>

          {/* Provider Status List */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Provider Status:</p>
            {parserProviderOptions.text.map((option) => (
              <div key={option.value} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{option.label}</span>
                {renderProviderStatus('text', option.value)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* API Keys Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="font-medium text-gray-900 dark:text-white mb-4">{t('settings:parser.apiKeys.title')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">{t('settings:parser.apiKeys.openai')}</label>
            <input
              type="password"
              value={settings.openaiApiKey}
              onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
              placeholder="sk-..."
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('settings:parser.apiKeys.optional')}{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                platform.openai.com
              </a>
            </p>
          </div>

          <div>
            <label className="label">{t('settings:parser.apiKeys.claude')}</label>
            <input
              type="password"
              value={settings.claudeApiKey}
              onChange={(e) => setSettings({ ...settings, claudeApiKey: e.target.value })}
              placeholder="sk-ant-..."
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('settings:parser.apiKeys.optional')}{' '}
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                console.anthropic.com
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Help Section */}
      <InlineHelp
        title={t('settings:parser.help.title')}
        category="advanced"
        content={
          <div className="space-y-3">
            <div>
              <p className="font-semibold mb-1">{t('settings:parser.help.modes.title')}</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>
                  <strong>{t('settings:parser.help.modes.auto')}:</strong> {t('settings:parser.help.modes.autoDesc')}
                </li>
                <li>
                  <strong>{t('settings:parser.help.modes.ollama')}:</strong> {t('settings:parser.help.modes.ollamaDesc')}
                </li>
                <li>
                  <strong>{t('settings:parser.help.modes.cloud')}:</strong> {t('settings:parser.help.modes.cloudDesc')}
                </li>
                <li>
                  <strong>{t('settings:parser.help.modes.fallback')}:</strong> {t('settings:parser.help.modes.fallbackDesc')}
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-1">{t('settings:parser.help.bestPractices.title')}</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>{t('settings:parser.help.bestPractices.auto')}</li>
                <li>{t('settings:parser.help.bestPractices.ollama')}</li>
                <li>{t('settings:parser.help.bestPractices.cloud')}</li>
                <li>{t('settings:parser.help.bestPractices.trained')}</li>
              </ul>
            </div>
          </div>
        }
      />
    </div>
  );
}
