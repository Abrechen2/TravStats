import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

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
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      {/* Header with Save Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {t("admin:parserSettings.title")}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {t("admin:parserSettings.description")}
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={savingParsers}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
        >
          {savingParsers ? t("common:buttons.saving") : t("admin:saveSettings")}
        </button>
      </div>

      <InlineHelp
        title={t("admin:parserSettings.help.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>{t("admin:parserSettings.help.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:parserSettings.help.freeTitle")}</strong>{" "}
                {t("admin:parserSettings.help.free")}
              </li>
              <li>
                <strong>{t("admin:parserSettings.help.cloudTitle")}</strong>{" "}
                {t("admin:parserSettings.help.cloud")}
              </li>
              <li>
                <strong>{t("admin:parserSettings.help.autoTitle")}</strong>{" "}
                {t("admin:parserSettings.help.auto")}
              </li>
            </ul>
          </div>
        }
      />

      {/* Default Parser Settings */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          {t("admin:parserSettings.defaultSettings")}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t("admin:parserSettings.defaultSettingsDescription")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {t("admin:parserSettings.visionParser")}
            </label>
            <select
              value={parserSettings.defaultVisionParser}
              onChange={(e) =>
                onParserSettingsChange({ ...parserSettings, defaultVisionParser: e.target.value })
              }
              className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--color-border)] rounded-lg text-[var(--text-primary)]"
            >
              <option value="auto">Auto (Recommended)</option>
              <option value="ollama">Ollama Vision</option>
              <option value="openai">OpenAI GPT-4 Vision</option>
              <option value="claude">Claude 3.5 Vision</option>
              <option value="tesseract">Tesseract OCR</option>
              <option value="manual">Manual Entry</option>
            </select>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t("admin:parserSettings.autoHelp")}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {t("admin:parserSettings.textParser")}
            </label>
            <select
              value={parserSettings.defaultTextParser}
              onChange={(e) =>
                onParserSettingsChange({ ...parserSettings, defaultTextParser: e.target.value })
              }
              className="w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--color-border)] rounded-lg text-[var(--text-primary)]"
            >
              <option value="auto">Auto (Recommended)</option>
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI GPT-4</option>
              <option value="claude">Claude 3.5</option>
              <option value="regex">Regex Fallback</option>
            </select>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t("admin:parserSettings.autoHelp")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
