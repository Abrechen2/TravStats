import { useState, useEffect } from 'react';
import { parseApi, settingsApi } from '../../lib/api';

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
      return <span className="text-xs text-gray-400">Loading...</span>;
    }

    const status = getProviderStatus(providerType, providerName);
    if (!status) return null;

    if (status.available) {
      return (
        <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Available</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400" title={status.reason}>
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span>Unavailable</span>
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
      alert('Parser settings saved successfully!');
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      const errorMessage = error.response?.data?.error || 'Failed to save settings';
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
          <h2 className="text-xl font-semibold">Parser Configuration</h2>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Configure how boarding passes and emails are parsed. Auto mode automatically selects the best available parser.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vision Parser (Boarding Pass) */}
        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-1">Vision Parser (Boarding Pass)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Parse uploaded boarding pass images</p>
          </div>

          <div>
            <label className="label">Preferred Parser</label>
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
            <h3 className="font-medium text-gray-900 dark:text-white mb-1">Text Parser (Email)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Parse flight booking emails</p>
          </div>

          <div>
            <label className="label">Preferred Parser</label>
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
        <h3 className="font-medium text-gray-900 dark:text-white mb-4">API Keys (Optional)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">OpenAI API Key</label>
            <input
              type="password"
              value={settings.openaiApiKey}
              onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
              placeholder="sk-..."
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Optional. Get from{' '}
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
            <label className="label">Claude API Key</label>
            <input
              type="password"
              value={settings.claudeApiKey}
              onChange={(e) => setSettings({ ...settings, claudeApiKey: e.target.value })}
              placeholder="sk-ant-..."
              className="input font-mono text-sm"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Optional. Get from{' '}
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
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <p className="font-medium mb-1">Parser Help</p>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Auto mode</strong> automatically chooses the best available parser</li>
              <li>• <strong>Ollama</strong> runs locally (free, but needs good hardware)</li>
              <li>• <strong>OpenAI/Claude</strong> are cloud-based (paid, but work on any device)</li>
              <li>• <strong>Tesseract/Regex</strong> are free fallbacks (lower accuracy)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
