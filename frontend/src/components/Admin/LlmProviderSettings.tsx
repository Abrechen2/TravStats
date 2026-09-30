import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api";
import type { CloudProviderKind, LlmProviderTestResult } from "../../lib/api/admin";
import { CLOUD_PROVIDER_KINDS } from "../../lib/api/admin";
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

/** The admin's saved priority, completed with any missing kind — mirrors the backend's `parseProviderOrder`. */
function providerOrder(settings: ParserSettingsData): CloudProviderKind[] {
  const saved = settings.llmProviderOrder ?? [];
  const order: CloudProviderKind[] = [];
  for (const kind of saved) if (!order.includes(kind)) order.push(kind);
  for (const kind of CLOUD_PROVIDER_KINDS) if (!order.includes(kind)) order.push(kind);
  return order;
}

function moveInOrder(
  order: CloudProviderKind[],
  kind: CloudProviderKind,
  delta: 1 | -1
): CloudProviderKind[] {
  const index = order.indexOf(kind);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Per-slot field values, read from the flat `ParserSettingsData` shape explicitly — no dynamic key lookup. */
interface SlotValues {
  model: string | null | undefined;
  apiKey: string | null | undefined;
  optIn: boolean | undefined;
  baseUrl?: string | null;
  isCloud: boolean;
}

function slotValues(kind: CloudProviderKind, settings: ParserSettingsData): SlotValues {
  switch (kind) {
    case "openai":
      return {
        model: settings.llmOpenaiModel,
        apiKey: settings.llmOpenaiApiKey,
        optIn: settings.llmOpenaiOptIn,
        isCloud: true,
      };
    case "anthropic":
      return {
        model: settings.llmAnthropicModel,
        apiKey: settings.llmAnthropicApiKey,
        optIn: settings.llmAnthropicOptIn,
        isCloud: true,
      };
    case "google":
      return {
        model: settings.llmGoogleModel,
        apiKey: settings.llmGoogleApiKey,
        optIn: settings.llmGoogleOptIn,
        isCloud: true,
      };
    case "custom":
      return {
        model: settings.openaiCompatModel,
        apiKey: settings.openaiCompatApiKey,
        optIn: settings.llmCustomOptIn,
        baseUrl: settings.openaiCompatBaseUrl,
        isCloud: settings.openaiCompatIsCloud ?? true,
      };
  }
}

function patchFor(
  kind: CloudProviderKind,
  patch: Partial<SlotValues>
): Partial<ParserSettingsData> {
  switch (kind) {
    case "openai":
      return {
        ...(patch.model !== undefined ? { llmOpenaiModel: patch.model } : {}),
        ...(patch.apiKey !== undefined ? { llmOpenaiApiKey: patch.apiKey } : {}),
        ...(patch.optIn !== undefined ? { llmOpenaiOptIn: patch.optIn } : {}),
      };
    case "anthropic":
      return {
        ...(patch.model !== undefined ? { llmAnthropicModel: patch.model } : {}),
        ...(patch.apiKey !== undefined ? { llmAnthropicApiKey: patch.apiKey } : {}),
        ...(patch.optIn !== undefined ? { llmAnthropicOptIn: patch.optIn } : {}),
      };
    case "google":
      return {
        ...(patch.model !== undefined ? { llmGoogleModel: patch.model } : {}),
        ...(patch.apiKey !== undefined ? { llmGoogleApiKey: patch.apiKey } : {}),
        ...(patch.optIn !== undefined ? { llmGoogleOptIn: patch.optIn } : {}),
      };
    case "custom":
      return {
        ...(patch.model !== undefined ? { openaiCompatModel: patch.model } : {}),
        ...(patch.apiKey !== undefined ? { openaiCompatApiKey: patch.apiKey } : {}),
        ...(patch.optIn !== undefined ? { llmCustomOptIn: patch.optIn } : {}),
        ...(patch.baseUrl !== undefined ? { openaiCompatBaseUrl: patch.baseUrl } : {}),
      };
  }
}

const DEFAULT_MODEL_KEY: Record<CloudProviderKind, string> = {
  openai: "admin:parserSettings.provider.slots.openai.modelPlaceholder",
  anthropic: "admin:parserSettings.provider.slots.anthropic.modelPlaceholder",
  google: "admin:parserSettings.provider.slots.google.modelPlaceholder",
  custom: "admin:parserSettings.provider.modelLabel",
};

/**
 * The provider chain (beta.18): Ollama is always tried first when it has an
 * endpoint (configured above, no card of its own here — see `ParserSettings`'
 * "Ollama LLM Parser" section). Below is the admin's priority among the four
 * cloud slots — each with its OWN key, model and consent. A slot missing
 * either its key or its consent is simply absent from the chain: TravStats
 * never tries it and never shows a warning that looks like an attempt.
 *
 * Each consent block is always visible, not only once a key is typed: the
 * server holds a remote Ollama to the same rule, and a warning that appears
 * only after the fact is easy to miss.
 */
export default function LlmProviderSettings({
  parserSettings,
  onParserSettingsChange,
}: LlmProviderSettingsProps): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const order = providerOrder(parserSettings);

  const reorder = (kind: CloudProviderKind, delta: 1 | -1): void => {
    onParserSettingsChange({
      ...parserSettings,
      llmProviderOrder: moveInOrder(order, kind, delta),
    });
  };

  return (
    <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6" data-testid="llm-provider-settings">
      <h3 className="text-lg font-semibold text-(--text-primary) mb-2">
        {t("admin:parserSettings.provider.title")}
      </h3>
      <p className="text-sm text-(--text-muted) mb-4">
        {t("admin:parserSettings.provider.description")}
      </p>

      <h4 className="text-sm font-semibold text-(--text-primary) mb-1">
        {t("admin:parserSettings.provider.chain.title")}
      </h4>
      <p className="text-xs text-(--text-muted) mb-4">
        {t("admin:parserSettings.provider.chain.hint")}
      </p>

      <div className="space-y-4">
        {order.map((kind, index) => (
          <CloudSlotCard
            key={kind}
            kind={kind}
            index={index}
            total={order.length}
            parserSettings={parserSettings}
            onParserSettingsChange={onParserSettingsChange}
            onMoveUp={(): void => reorder(kind, -1)}
            onMoveDown={(): void => reorder(kind, 1)}
          />
        ))}
      </div>
    </div>
  );
}

function CloudSlotCard({
  kind,
  index,
  total,
  parserSettings,
  onParserSettingsChange,
  onMoveUp,
  onMoveDown,
}: {
  kind: CloudProviderKind;
  index: number;
  total: number;
  parserSettings: ParserSettingsData;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const values = slotValues(kind, parserSettings);
  const isCustom = kind === "custom";

  const change = (patch: Partial<SlotValues>): void => {
    onParserSettingsChange({ ...parserSettings, ...patchFor(kind, patch) });
    setTestState({ status: "idle" });
  };

  const canTest = isCustom ? !!values.baseUrl : true;

  const handleTest = async (): Promise<void> => {
    if (!canTest) return;
    setTestState({ status: "loading" });
    try {
      const result = await adminApi.testLlmProvider({
        kind,
        ...(isCustom ? { baseUrl: values.baseUrl ?? null } : {}),
        model: values.model ?? null,
        apiKey: values.apiKey ?? null,
      });
      setTestState({ status: "done", result });
    } catch (err) {
      logger.error("LLM provider test failed", err);
      setTestState({ status: "failed" });
    }
  };

  const configured = isCustom ? !!values.baseUrl && !!values.model : !!values.apiKey;
  const savedWithoutConsent = configured && values.isCloud && values.optIn !== true;

  return (
    <div className="rounded-lg border border-(--color-border) p-4" data-testid={`llm-slot-${kind}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-(--text-primary)">
          {t(`admin:parserSettings.provider.slots.${kind}.name`)}
        </h4>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={t("admin:parserSettings.provider.chain.moveUp")}
            className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-(--bg-base) disabled:opacity-30 transition"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label={t("admin:parserSettings.provider.chain.moveDown")}
            className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-(--bg-base) disabled:opacity-30 transition"
          >
            ↓
          </button>
        </div>
      </div>

      {isCustom && (
        <p className="text-xs text-(--text-muted) mb-3">
          {t("admin:parserSettings.provider.slots.custom.hint")}
        </p>
      )}

      <div className="space-y-3 mb-4">
        {isCustom && (
          <div>
            <label
              htmlFor={`llm-slot-${kind}-base-url`}
              className="block text-xs font-medium text-(--text-muted) mb-1"
            >
              {t("admin:parserSettings.provider.baseUrlLabel")}
            </label>
            <input
              id={`llm-slot-${kind}-base-url`}
              type="url"
              value={values.baseUrl ?? ""}
              onChange={(e): void => change({ baseUrl: e.target.value || null })}
              placeholder={t("admin:parserSettings.provider.baseUrlPlaceholder")}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-(--text-muted)">
              {t("admin:parserSettings.provider.baseUrlHint")}
            </p>
          </div>
        )}
        <div>
          <label
            htmlFor={`llm-slot-${kind}-model`}
            className="block text-xs font-medium text-(--text-muted) mb-1"
          >
            {t("admin:parserSettings.provider.modelLabel")}
          </label>
          <input
            id={`llm-slot-${kind}-model`}
            type="text"
            value={values.model ?? ""}
            onChange={(e): void => change({ model: e.target.value || null })}
            placeholder={isCustom ? "" : t(DEFAULT_MODEL_KEY[kind])}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label
            htmlFor={`llm-slot-${kind}-key`}
            className="block text-xs font-medium text-(--text-muted) mb-1"
          >
            {t("admin:parserSettings.provider.keyLabel")}
          </label>
          {/* The field holds the masked echo until the admin types a new
              key; sending the echo back keeps the stored one. */}
          <input
            id={`llm-slot-${kind}-key`}
            type="password"
            autoComplete="off"
            value={values.apiKey ?? ""}
            onChange={(e): void => change({ apiKey: e.target.value })}
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
            disabled={testState.status === "loading" || !canTest}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-(--bg-base) disabled:opacity-50 transition"
          >
            {testState.status === "loading"
              ? t("admin:parserSettings.provider.testing")
              : t("admin:parserSettings.provider.testButton")}
          </button>
          <TestOutcome state={testState} model={values.model ?? null} />
        </div>
      </div>

      <div
        className="rounded-lg border border-(--color-border) bg-(--bg-base) p-4"
        style={{ borderColor: "var(--warning)" }}
        data-testid={`llm-consent-${kind}`}
      >
        <p className="text-sm font-medium text-(--text-primary) mb-1">
          {t(`admin:parserSettings.provider.slots.${kind}.consent.title`)}
        </p>
        <p className="text-xs text-(--text-muted) mb-3">
          {t(`admin:parserSettings.provider.slots.${kind}.consent.warning`)}
        </p>
        <label className="flex items-start gap-2 text-sm text-(--text-primary)">
          <input
            type="checkbox"
            data-testid={`llm-consent-checkbox-${kind}`}
            checked={values.optIn === true}
            onChange={(e): void => change({ optIn: e.target.checked })}
            className="mt-0.5 w-4 h-4 rounded-sm border-border"
          />
          {t(`admin:parserSettings.provider.slots.${kind}.consent.label`)}
        </label>
        {savedWithoutConsent && (
          <p className="mt-2 text-xs font-medium" style={{ color: "var(--warning)" }} role="status">
            {t(`admin:parserSettings.provider.slots.${kind}.consent.inactive`)}
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
