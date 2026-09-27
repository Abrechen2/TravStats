import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import type { LlmProviderKind, LlmProviderTestResult } from "../../lib/api/admin";
import { logger } from "../../lib/logger";
import type { ParserSettingsData } from "./ParserSettings";

interface LlmProviderSettingsProps {
  parserSettings: ParserSettingsData;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
}

type TestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: LlmProviderTestResult }
  | { status: "failed" };

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-(--bg-base) text-(--text-primary) focus:outline-hidden focus:ring-1 focus:ring-(--color-accent)";

/**
 * The provider choice (beta.17): Ollama, or any OpenAI-compatible endpoint
 * with a key — and the explicit consent a cloud endpoint needs.
 *
 * The consent block is always visible, not only once a cloud URL is typed:
 * the server holds an Ollama at a public address to the same rule, and a
 * warning that appears only after the fact is easy to miss. What it names is
 * exactly what the backend sends (`services/llm/llmProvider.ts` callers).
 */
export default function LlmProviderSettings({
  parserSettings,
  onParserSettingsChange,
}: LlmProviderSettingsProps): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const provider: LlmProviderKind = parserSettings.llmProvider ?? "ollama";
  const change = (patch: Partial<ParserSettingsData>): void => {
    onParserSettingsChange({ ...parserSettings, ...patch });
    setTestState({ status: "idle" });
  };

  const handleTest = async (): Promise<void> => {
    if (!parserSettings.openaiCompatBaseUrl) return;
    setTestState({ status: "loading" });
    try {
      const result = await adminApi.testLlmProvider({
        baseUrl: parserSettings.openaiCompatBaseUrl,
        model: parserSettings.openaiCompatModel ?? null,
        apiKey: parserSettings.openaiCompatApiKey ?? null,
      });
      setTestState({ status: "done", result });
    } catch (err) {
      logger.error("LLM provider test failed", err);
      setTestState({ status: "failed" });
    }
  };

  const savedCloudWithoutConsent =
    provider === "openai_compatible" &&
    parserSettings.openaiCompatIsCloud === true &&
    parserSettings.llmCloudOptIn !== true;

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6" data-testid="llm-provider-settings">
      <h3 className="text-lg font-semibold text-(--text-primary) mb-2">
        {t("admin:parserSettings.provider.title")}
      </h3>
      <p className="text-sm text-(--text-muted) mb-4">
        {t("admin:parserSettings.provider.description")}
      </p>

      <fieldset className="flex flex-col gap-2 mb-4">
        {(["ollama", "openai_compatible"] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm text-(--text-primary)">
            <input
              type="radio"
              name="llm-provider"
              value={kind}
              data-testid={`llm-provider-${kind}`}
              checked={provider === kind}
              onChange={(): void => change({ llmProvider: kind })}
            />
            {kind === "ollama"
              ? t("admin:parserSettings.provider.ollama")
              : t("admin:parserSettings.provider.openaiCompatible")}
          </label>
        ))}
      </fieldset>

      {provider === "openai_compatible" && (
        <div className="space-y-3 mb-4">
          <div>
            <label
              htmlFor="openai-compat-base-url"
              className="block text-xs font-medium text-(--text-muted) mb-1"
            >
              {t("admin:parserSettings.provider.baseUrlLabel")}
            </label>
            <input
              id="openai-compat-base-url"
              type="url"
              value={parserSettings.openaiCompatBaseUrl ?? ""}
              onChange={(e): void => change({ openaiCompatBaseUrl: e.target.value || null })}
              placeholder={t("admin:parserSettings.provider.baseUrlPlaceholder")}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-(--text-muted)">
              {t("admin:parserSettings.provider.baseUrlHint")}
            </p>
          </div>
          <div>
            <label
              htmlFor="openai-compat-model"
              className="block text-xs font-medium text-(--text-muted) mb-1"
            >
              {t("admin:parserSettings.provider.modelLabel")}
            </label>
            <input
              id="openai-compat-model"
              type="text"
              value={parserSettings.openaiCompatModel ?? ""}
              onChange={(e): void => change({ openaiCompatModel: e.target.value || null })}
              placeholder={t("admin:parserSettings.provider.modelPlaceholder")}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="openai-compat-key"
              className="block text-xs font-medium text-(--text-muted) mb-1"
            >
              {t("admin:parserSettings.provider.keyLabel")}
            </label>
            {/* The field holds the masked echo until the admin types a new
                key; sending the echo back keeps the stored one. */}
            <input
              id="openai-compat-key"
              type="password"
              autoComplete="off"
              value={parserSettings.openaiCompatApiKey ?? ""}
              onChange={(e): void => change({ openaiCompatApiKey: e.target.value })}
              placeholder={t("admin:parserSettings.provider.keyPlaceholder")}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-(--text-muted)">
              {t("admin:parserSettings.provider.keyHint")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={(): void => void handleTest()}
              disabled={testState.status === "loading" || !parserSettings.openaiCompatBaseUrl}
              className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-(--bg-base) disabled:opacity-50 transition"
            >
              {testState.status === "loading"
                ? t("admin:parserSettings.provider.testing")
                : t("admin:parserSettings.provider.testButton")}
            </button>
            <TestOutcome state={testState} model={parserSettings.openaiCompatModel ?? null} />
          </div>
        </div>
      )}

      <div
        className="rounded-lg border border-(--color-border) bg-(--bg-base) p-4"
        style={{ borderColor: "var(--warning)" }}
        data-testid="llm-cloud-consent"
      >
        <p className="text-sm font-medium text-(--text-primary) mb-1">
          {t("admin:parserSettings.provider.cloud.title")}
        </p>
        <p className="text-xs text-(--text-muted) mb-3">
          {t("admin:parserSettings.provider.cloud.warning")}
        </p>
        <label className="flex items-start gap-2 text-sm text-(--text-primary)">
          <input
            type="checkbox"
            data-testid="llm-cloud-opt-in"
            checked={parserSettings.llmCloudOptIn === true}
            onChange={(e): void => change({ llmCloudOptIn: e.target.checked })}
            className="mt-0.5 w-4 h-4 rounded-sm border-border"
          />
          {t("admin:parserSettings.provider.cloud.label")}
        </label>
        <p className="mt-2 text-xs text-(--text-muted)">
          {t("admin:parserSettings.provider.cloud.hint")}
        </p>
        {savedCloudWithoutConsent && (
          <p className="mt-2 text-xs font-medium" style={{ color: "var(--warning)" }} role="status">
            {t("admin:parserSettings.provider.cloud.inactive")}
          </p>
        )}
      </div>
    </div>
  );
}

function TestOutcome({
  state,
  model,
}: {
  state: TestState;
  model: string | null;
}): JSX.Element | null {
  const { t } = useTranslation(["admin"]);
  if (state.status === "idle" || state.status === "loading") return null;
  if (state.status === "failed") {
    return (
      <p className="text-xs" style={{ color: "var(--danger)" }} role="alert">
        {t("admin:parserSettings.provider.test.errors.failed")}
      </p>
    );
  }
  const { result } = state;
  if (!result.ok) {
    return (
      <p className="text-xs" style={{ color: "var(--danger)" }} role="alert">
        {t(`admin:parserSettings.provider.test.errors.${result.errorCode}`)}
      </p>
    );
  }
  const message =
    result.modelFound === false
      ? t("admin:parserSettings.provider.test.okModelMissing", { model: model ?? "" })
      : result.modelFound === null
        ? t("admin:parserSettings.provider.test.okNoList")
        : t("admin:parserSettings.provider.test.ok", { count: result.modelCount });
  return (
    <p
      className="text-xs"
      style={{ color: result.modelFound === false ? "var(--warning)" : "var(--success)" }}
      role="status"
    >
      {message}
      {result.isCloud ? ` ${t("admin:parserSettings.provider.test.cloud")}` : ""}
    </p>
  );
}
