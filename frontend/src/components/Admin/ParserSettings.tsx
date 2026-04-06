import { useTranslation } from "../../hooks/useTranslation";

export interface ParserSettingsData {
  allowUserApiKeys: boolean;
  defaultVisionParser: string;
  defaultTextParser: string;
  ollamaUrl: string | null;
  ollamaModel: string | null;
}

interface ParserSettingsProps {
  parserSettings: ParserSettingsData;
  savingParsers: boolean;
  onSave: () => void;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
  onTestOllama: () => void;
  ollamaTestState: { status: "idle" | "loading" | "ok" | "error" | "warn"; message?: string };
}

export default function ParserSettings({
  parserSettings,
  savingParsers,
  onSave,
  onParserSettingsChange,
  onTestOllama,
  ollamaTestState,
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

      {/* Parser Info */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          {t("admin:parserSettings.defaultSettings")}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t("admin:parserSettings.defaultSettingsDescription")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-2 p-3 bg-[var(--bg-base)] rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Tesseract OCR</p>
              <p className="text-xs text-[var(--text-muted)]">Boarding pass image parsing</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-[var(--bg-base)] rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Regex Templates</p>
              <p className="text-xs text-[var(--text-muted)]">Email booking parsing</p>
            </div>
          </div>
        </div>
      </div>

      {/* Ollama LLM Parser */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("admin:parserSettings.ollama.title")}
          </h3>
          {ollamaTestState.status !== "idle" && (
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                ollamaTestState.status === "ok"
                  ? "bg-green-100 text-green-700"
                  : ollamaTestState.status === "warn"
                    ? "bg-yellow-100 text-yellow-700"
                    : ollamaTestState.status === "error"
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-500"
              }`}
            >
              {ollamaTestState.status === "ok" && t("admin:parserSettings.ollama.statusConnected")}
              {ollamaTestState.status === "warn" && t("admin:parserSettings.ollama.modelNotFound")}
              {ollamaTestState.status === "error" &&
                t("admin:parserSettings.ollama.statusDisconnected")}
              {ollamaTestState.status === "loading" && t("admin:parserSettings.ollama.testing")}
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t("admin:parserSettings.ollama.description")}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              {t("admin:parserSettings.ollama.urlLabel")}
            </label>
            <input
              type="url"
              value={parserSettings.ollamaUrl ?? ""}
              onChange={(e) =>
                onParserSettingsChange({ ...parserSettings, ollamaUrl: e.target.value || null })
              }
              placeholder={t("admin:parserSettings.ollama.urlPlaceholder")}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              {t("admin:parserSettings.ollama.modelLabel")}
            </label>
            <input
              type="text"
              value={parserSettings.ollamaModel ?? ""}
              onChange={(e) =>
                onParserSettingsChange({ ...parserSettings, ollamaModel: e.target.value || null })
              }
              placeholder={t("admin:parserSettings.ollama.modelPlaceholder")}
              className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {ollamaTestState.message && (
            <p className="text-xs text-[var(--text-muted)] mt-1">{ollamaTestState.message}</p>
          )}
          <button
            onClick={onTestOllama}
            disabled={
              ollamaTestState.status === "loading" ||
              !parserSettings.ollamaUrl ||
              !parserSettings.ollamaModel
            }
            className="mt-1 px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg hover:bg-[var(--bg-base)] disabled:opacity-50 transition"
          >
            {ollamaTestState.status === "loading"
              ? t("admin:parserSettings.ollama.testing")
              : t("admin:parserSettings.ollama.testButton")}
          </button>
        </div>
      </div>

      {/* User API Key Permissions */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">User Permissions</h3>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="allowUserApiKeys"
            checked={parserSettings.allowUserApiKeys}
            onChange={(e) =>
              onParserSettingsChange({ ...parserSettings, allowUserApiKeys: e.target.checked })
            }
            className="w-4 h-4 rounded border-[var(--color-border)]"
          />
          <label htmlFor="allowUserApiKeys" className="text-sm text-[var(--text-primary)]">
            Allow users to add their own flight data API keys (Airlabs, Aviationstack, OpenSky)
          </label>
        </div>
      </div>
    </div>
  );
}
