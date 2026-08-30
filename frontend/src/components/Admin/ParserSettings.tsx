import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";

export interface ParserSettingsData {
  allowUserApiKeys: boolean;
  /** Whether this instance may ask jsDelivr for rates the ECB does not carry. */
  fxCdnFallbackEnabled: boolean;
  defaultVisionParser: string;
  defaultTextParser: string;
  ollamaUrl: string | null;
  ollamaModel: string | null;
}

interface OllamaModel {
  name: string;
  size: number;
  modified: string;
}

interface ParserSettingsProps {
  parserSettings: ParserSettingsData;
  savingParsers: boolean;
  onSave: () => void;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
  onTestOllama: () => void;
  ollamaTestState: { status: "idle" | "loading" | "ok" | "error" | "warn"; message?: string };
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
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
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [pullModel, setPullModel] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const loadModels = useCallback(async () => {
    if (!parserSettings.ollamaUrl) return;
    setModelsLoading(true);
    try {
      const result = await adminApi.listOllamaModels(parserSettings.ollamaUrl);
      if (result.success && result.models) {
        setModels(result.models);
      } else {
        setModels([]);
      }
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [parserSettings.ollamaUrl]);

  // Load models when URL changes (debounced)
  useEffect(() => {
    if (!parserSettings.ollamaUrl) {
      setModels([]);
      return;
    }
    const timer = setTimeout(loadModels, 500);
    return () => clearTimeout(timer);
  }, [parserSettings.ollamaUrl, loadModels]);

  const handlePull = async () => {
    if (!parserSettings.ollamaUrl || !pullModel.trim()) return;
    setPulling(true);
    setPullStatus(null);
    try {
      const result = await adminApi.pullOllamaModel(parserSettings.ollamaUrl, pullModel.trim());
      if (result.success) {
        setPullStatus({ ok: true, message: `${pullModel.trim()} downloaded` });
        setPullModel("");
        loadModels();
      } else {
        setPullStatus({ ok: false, message: result.error ?? "Pull failed" });
      }
    } catch {
      setPullStatus({ ok: false, message: "Connection failed" });
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Save Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-(--text-primary)">
            {t("admin:parserSettings.title")}
          </h2>
          <p className="text-sm text-(--text-muted) mt-1">
            {t("admin:parserSettings.description")}
          </p>
        </div>
        <button onClick={onSave} disabled={savingParsers} className="btn-primary">
          {savingParsers ? t("common:buttons.saving") : t("admin:saveSettings")}
        </button>
      </div>


      {/* Parser Info */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-(--text-primary) mb-2">
          {t("admin:parserSettings.defaultSettings")}
        </h3>
        <p className="text-sm text-(--text-muted) mb-4">
          {t("admin:parserSettings.defaultSettingsDescription")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-2 p-3 bg-(--bg-base) rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-(--text-primary)">Tesseract OCR</p>
              <p className="text-xs text-(--text-muted)">Boarding pass image parsing</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-(--bg-base) rounded-lg">
            <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-(--text-primary)">Regex Templates</p>
              <p className="text-xs text-(--text-muted)">Email booking parsing</p>
            </div>
          </div>
        </div>
      </div>

      {/* Ollama LLM Parser */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-(--text-primary)">
            {t("admin:parserSettings.ollama.title")}
          </h3>
          {ollamaTestState.status !== "idle" && (
            <span
              className="text-xs font-medium px-2 py-1 rounded-full"
              style={{
                background:
                  ollamaTestState.status === "ok"
                    ? "rgba(63,185,80,0.15)"
                    : ollamaTestState.status === "warn"
                      ? "rgba(210,153,34,0.15)"
                      : ollamaTestState.status === "error"
                        ? "rgba(248,81,73,0.15)"
                        : "var(--bg-elevated)",
                color:
                  ollamaTestState.status === "ok"
                    ? "var(--success)"
                    : ollamaTestState.status === "warn"
                      ? "var(--warning)"
                      : ollamaTestState.status === "error"
                        ? "var(--danger)"
                        : "var(--text-muted)",
              }}
            >
              {ollamaTestState.status === "ok" && t("admin:parserSettings.ollama.statusConnected")}
              {ollamaTestState.status === "warn" && t("admin:parserSettings.ollama.modelNotFound")}
              {ollamaTestState.status === "error" &&
                t("admin:parserSettings.ollama.statusDisconnected")}
              {ollamaTestState.status === "loading" && t("admin:parserSettings.ollama.testing")}
            </span>
          )}
        </div>
        <p className="text-sm text-(--text-muted) mb-4">
          {t("admin:parserSettings.ollama.description")}
        </p>
        <div className="space-y-3">
          {/* URL input */}
          <div>
            <label className="block text-xs font-medium text-(--text-muted) mb-1">
              {t("admin:parserSettings.ollama.urlLabel")}
            </label>
            <input
              type="url"
              value={parserSettings.ollamaUrl ?? ""}
              onChange={(e) =>
                onParserSettingsChange({ ...parserSettings, ollamaUrl: e.target.value || null })
              }
              placeholder={t("admin:parserSettings.ollama.urlPlaceholder")}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-(--bg-base) text-(--text-primary) focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Model selector — dropdown of available models */}
          <div>
            <label className="block text-xs font-medium text-(--text-muted) mb-1">
              {t("admin:parserSettings.ollama.modelLabel")}
            </label>
            {models.length > 0 ? (
              <select
                value={parserSettings.ollamaModel ?? ""}
                onChange={(e) =>
                  onParserSettingsChange({ ...parserSettings, ollamaModel: e.target.value || null })
                }
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-(--bg-base) text-(--text-primary) focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- Select model --</option>
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({formatSize(m.size)})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={parserSettings.ollamaModel ?? ""}
                onChange={(e) =>
                  onParserSettingsChange({ ...parserSettings, ollamaModel: e.target.value || null })
                }
                placeholder={
                  modelsLoading
                    ? "Loading models..."
                    : parserSettings.ollamaUrl
                      ? "No models found — enter name or pull below"
                      : t("admin:parserSettings.ollama.modelPlaceholder")
                }
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-(--bg-base) text-(--text-primary) focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            )}
            {modelsLoading && (
              <p className="text-xs text-(--text-muted) mt-1">Loading available models...</p>
            )}
          </div>

          {/* Pull model section */}
          {parserSettings.ollamaUrl && (
            <div className="border border-dashed border-border rounded-lg p-3">
              <label className="block text-xs font-medium text-(--text-muted) mb-1">
                Download a model
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pullModel}
                  onChange={(e) => setPullModel(e.target.value)}
                  placeholder="e.g. gemma3:12b, llama3.1:8b"
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-(--bg-base) text-(--text-primary) focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                  disabled={pulling}
                />
                <button
                  onClick={handlePull}
                  disabled={pulling || !pullModel.trim()}
                  className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white rounded-lg transition whitespace-nowrap"
                >
                  {pulling ? "Pulling..." : "Pull"}
                </button>
              </div>
              {pullStatus && (
                <p className={`text-xs mt-1 ${pullStatus.ok ? "text-green-600" : "text-red-500"}`}>
                  {pullStatus.message}
                </p>
              )}
            </div>
          )}

          {ollamaTestState.message && (
            <p className="text-xs text-(--text-muted) mt-1">{ollamaTestState.message}</p>
          )}
          <button
            onClick={onTestOllama}
            disabled={
              ollamaTestState.status === "loading" ||
              !parserSettings.ollamaUrl ||
              !parserSettings.ollamaModel
            }
            className="mt-1 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-(--bg-base) disabled:opacity-50 transition"
          >
            {ollamaTestState.status === "loading"
              ? t("admin:parserSettings.ollama.testing")
              : t("admin:parserSettings.ollama.testButton")}
          </button>
        </div>
      </div>

      {/* User API Key Permissions */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-(--text-primary) mb-2">User Permissions</h3>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="allowUserApiKeys"
            checked={parserSettings.allowUserApiKeys}
            onChange={(e) =>
              onParserSettingsChange({ ...parserSettings, allowUserApiKeys: e.target.checked })
            }
            className="w-4 h-4 rounded-sm border-border"
          />
          <label htmlFor="allowUserApiKeys" className="text-sm text-(--text-primary)">
            Allow users to add their own flight data API keys (Airlabs, Aviationstack, OpenSky)
          </label>
        </div>
      </div>

      {/* Which outside service this instance may reach for exchange rates —
          the same kind of decision as the Ollama URL above, which is why it
          sits here rather than in a user's own settings. */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-(--text-primary) mb-2">
          {t("admin:fxCdn.title")}
        </h3>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="fxCdnFallbackEnabled"
            checked={parserSettings.fxCdnFallbackEnabled}
            onChange={(e) =>
              onParserSettingsChange({ ...parserSettings, fxCdnFallbackEnabled: e.target.checked })
            }
            className="w-4 h-4 rounded-sm border-border"
          />
          <label htmlFor="fxCdnFallbackEnabled" className="text-sm text-(--text-primary)">
            {t("admin:fxCdn.label")}
          </label>
        </div>
        <p className="mt-2 text-xs text-(--text-muted)">{t("admin:fxCdn.description")}</p>
      </div>
    </div>
  );
}
