import { useTranslation } from '../../hooks/useTranslation';

export interface ParserSettingsData {
  globalOpenaiApiKey?: string;
  globalClaudeApiKey?: string;
  allowUserApiKeys: boolean;
  requireUserApiKeys: boolean;
  defaultVisionParser: string;
  defaultTextParser: string;
}

interface ParserSettingsProps {
  parserSettings: ParserSettingsData;
  savingParsers: boolean;
  onSave: () => void;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
}

export default function ParserSettings({
  parserSettings,
  savingParsers,
  onSave,
  onParserSettingsChange,
}: ParserSettingsProps): JSX.Element {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div className="space-y-6">
      {/* Header with Save Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Global Parser Configuration
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Configure default parser settings for all users. API keys are managed in the API Keys tab.
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={savingParsers}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
        >
          {savingParsers ? t('common:buttons.saving') : t('admin:saveSettings')}
        </button>
      </div>

      {/* Default Parser Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Default Parser Settings
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          These defaults will be applied to new user accounts. Users can change them in their settings.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Vision Parser (Boarding Pass)
            </label>
            <select
              value={parserSettings.defaultVisionParser}
              onChange={(e) => onParserSettingsChange({ ...parserSettings, defaultVisionParser: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              <option value="auto">Auto (Recommended)</option>
              <option value="ollama">Ollama Vision</option>
              <option value="openai">OpenAI GPT-4 Vision</option>
              <option value="claude">Claude 3.5 Vision</option>
              <option value="tesseract">Tesseract OCR</option>
              <option value="manual">Manual Entry</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Auto mode automatically selects the best available parser
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Text Parser (Email)
            </label>
            <select
              value={parserSettings.defaultTextParser}
              onChange={(e) => onParserSettingsChange({ ...parserSettings, defaultTextParser: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              <option value="auto">Auto (Recommended)</option>
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI GPT-4</option>
              <option value="claude">Claude 3.5</option>
              <option value="regex">Regex Fallback</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Auto mode automatically selects the best available parser
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
            <p className="font-medium mb-2">Parser Configuration Guide</p>
            <ul className="space-y-1 text-xs">
              <li>* <strong>Free Options</strong>: Ollama (local AI, GPU recommended), Tesseract (OCR), Regex (pattern matching)</li>
              <li>* <strong>Cloud Options</strong>: OpenAI (~$0.01-0.05/image, $0.002-0.01/email), Claude (~$0.01-0.03/image, $0.003-0.015/email)</li>
              <li>* <strong>Auto Mode</strong>: System prioritizes cloud AI &gt; local AI &gt; OCR/regex based on availability</li>
              <li>* <strong>API Keys</strong>: Global keys are shared across all users unless users provide their own</li>
              <li>* <strong>Fallback Chain</strong>: Users can configure custom fallback sequences in their settings</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
