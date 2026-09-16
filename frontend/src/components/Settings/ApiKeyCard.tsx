/**
 * API Key Card Component
 *
 * Reusable component for displaying and editing API keys
 */

import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi, adminApi } from "../../lib/api";
import type { ProviderQuota } from "../../lib/api/settings";
import { Icon } from "../ui/Icon";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { SettingRow } from "../ui/SettingRow";

export type ApiCardCapability = "historical365";

export interface ApiKeyCardProps {
  provider:
    | "airlabs"
    | "aviationstack"
    | "aerodatabox"
    | "opensky"
    | "logostream"
    | "googlePlaces"
    | "openrouteservice"
    | "graphhopper";
  label: string;
  description: string;
  getKeyUrl: string;
  isShared: boolean;
  hasAccess: boolean;
  value?: string;
  /** Whether the card offers a "Test" button. Every provider has a backend
   *  test endpoint now; pass false only for a provider that genuinely has
   *  none. */
  testable?: boolean;
  /** Explicit "the user has saved their own key" signal. User cards MUST
   *  pass this from `apiKeysStatus.<provider>.hasKey` because their `value`
   *  is always empty (the GET only returns booleans, never the stored key),
   *  which would otherwise mislabel an own key as "shared". Admin cards omit
   *  it and fall back to `!!value` (they pass the masked key back in). */
  hasOwnKey?: boolean;
  /** Per-provider quota observation. Different providers report this
   *  very differently — see `ProviderQuota` for the variants. */
  quota?: ProviderQuota;
  /** Capability tags to render as small badges next to the label. */
  capabilities?: ApiCardCapability[];
  onChange?: (value: string) => void;
  onClear?: () => void;
  isAdmin?: boolean; // If true, use adminApi instead of settingsApi
  // For OpenSky (multiple fields)
  /**
   * `card` (default) is the bordered tile the admin grid uses. `row` is the
   * round-4 settings row: name, description and status on one line, the key
   * fields folded behind "Bearbeiten" — most visits only need the status.
   */
  layout?: "card" | "row";
  openskyFields?: {
    clientId?: string;
    clientSecret?: string;
    username?: string;
    password?: string;
    onClientIdChange?: (value: string) => void;
    onClientSecretChange?: (value: string) => void;
    onUsernameChange?: (value: string) => void;
    onPasswordChange?: (value: string) => void;
  };
}

export default function ApiKeyCard({
  provider,
  label,
  description,
  getKeyUrl,
  isShared,
  hasAccess,
  value,
  testable = true,
  hasOwnKey: hasOwnKeyProp,
  quota,
  capabilities,
  onChange,
  onClear,
  isAdmin = false,
  layout = "card",
  openskyFields,
}: ApiKeyCardProps) {
  const { t } = useTranslation(["settings", "common"]);
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    messageKey?: string;
    messageParams?: Record<string, string | number>;
  } | null>(null);

  // #260: the backend names the outcome with a stable key; the English
  // `message` is only the fallback for keys this build doesn't know (and
  // for untranslatable upstream prose, which carries no key at all).
  const testResultText = (result: NonNullable<typeof testResult>): string =>
    result.messageKey
      ? t(`settings:apiKeyTest.${result.messageKey}`, {
          ...result.messageParams,
          defaultValue: result.message,
        })
      : result.message;

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    if (onChange) {
      onChange(newValue);
    }
  };

  const handleClear = () => {
    setLocalValue("");
    setTestResult(null);
    if (onClear) {
      onClear();
    }
  };

  const handleTest = async () => {
    if (!testable) {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      let result;
      if (provider === "opensky" && openskyFields) {
        const api = isAdmin ? adminApi : settingsApi;
        result = await api.testApiKey(provider, undefined, {
          clientId: openskyFields.clientId,
          clientSecret: openskyFields.clientSecret,
        });
      } else if (provider === "logostream" || provider === "googlePlaces") {
        // Admin-only providers — no user-level test endpoint exists, so
        // these always go through adminApi regardless of `isAdmin`.
        result = await adminApi.testApiKey(provider, localValue || value);
      } else {
        const api = isAdmin ? adminApi : settingsApi;
        result = await api.testApiKey(provider, localValue || value);
      }
      setTestResult(result);
    } catch (error: unknown) {
      // The "nothing configured to test" answer is a 400, so it arrives
      // here — carry its messageKey through, or the translation is lost
      // exactly where it matters most (#260).
      const errorObj = error as {
        response?: {
          data?: {
            message?: string;
            messageKey?: string;
            messageParams?: Record<string, string | number>;
          };
        };
        message?: string;
      };
      const data = errorObj.response?.data;
      setTestResult({
        success: false,
        message: data?.message || errorObj.message || t("settings:apiKeyTest.requestFailed"),
        messageKey: data?.messageKey,
        messageParams: data?.messageParams,
      });
    } finally {
      setTesting(false);
    }
  };

  // Prefer the explicit hasOwnKey signal (user cards); fall back to deriving
  // from the (masked) value for admin cards. For OpenSky the fallback checks
  // only clientId.
  const hasOwnKey =
    hasOwnKeyProp ?? (provider === "opensky" && openskyFields ? !!openskyFields.clientId : !!value);

  const statusPill = hasOwnKey ? (
    <Pill color={token("good")} title={t("settings:apiKeys.ownTooltip")}>
      {t("settings:apiKeys.own")}
    </Pill>
  ) : hasAccess ? (
    // Access via a shared key or the environment.
    <Pill color={token("accent")} title={t("settings:apiKeys.sharedTooltip")}>
      {t("settings:apiKeys.shared")}
    </Pill>
  ) : (
    <Pill color={token("muted")} dashed title={t("settings:apiKeys.notConfiguredTooltip")}>
      {t("settings:apiKeys.notConfigured")}
    </Pill>
  );

  const details = (
    <>
      {capabilities && capabilities.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {capabilities.map((cap) => (
            <Pill
              key={cap}
              color={token("accent")}
              title={t(`settings:apiKeys.capabilities.${cap}.tooltip`)}
            >
              {t(`settings:apiKeys.capabilities.${cap}.label`)}
            </Pill>
          ))}
        </span>
      )}
      {quota && (
        <span className="t-caption block">
          {quota.kind === "observed" && (
            <>
              {t("settings:apiKeys.quota.label")}:{" "}
              <span style={{ fontWeight: 600, color: "var(--ts-text)" }}>
                {quota.remaining ?? "?"}
              </span>
              {quota.limit !== null && <span> / {quota.limit}</span>}{" "}
              {t("settings:apiKeys.quota.unitsSuffix")}
              {quota.requestsLimit != null && quota.requestsRemaining != null && (
                <>
                  {" · "}
                  {t("settings:apiKeys.quota.requestsLabel")}: {quota.requestsRemaining} /{" "}
                  {quota.requestsLimit}
                </>
              )}
            </>
          )}
          {quota.kind === "not_reported" && (
            <>
              {t("settings:apiKeys.quota.notReported")}
              {quota.knownLimitHint &&
                ` (${t("settings:apiKeys.quota.staticHint", { limit: quota.knownLimitHint })})`}
            </>
          )}
          {quota.kind === "rate_limit_only" && t("settings:apiKeys.quota.rateLimitOnly")}
        </span>
      )}
    </>
  );

  const placeholder = isShared
    ? t("settings:apiKeys.sharedPlaceholder")
    : t("settings:apiKeys.enterKey");

  const revealButton = (
    <button
      type="button"
      onClick={() => setShowKey(!showKey)}
      className="btn-secondary"
      aria-label={showKey ? t("settings:apiKeys.hide") : t("settings:apiKeys.show")}
      title={showKey ? t("settings:apiKeys.hide") : t("settings:apiKeys.show")}
    >
      <Icon name={showKey ? "eye-off" : "eye"} size={16} />
    </button>
  );

  const editor = (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {provider === "opensky" && openskyFields ? (
        <>
          <div>
            <label className="label" htmlFor={`${provider}-client-id`}>
              {t("settings:apiKeys.opensky.clientId")}
            </label>
            <div className="flex gap-2">
              <input
                id={`${provider}-client-id`}
                type={showKey ? "text" : "password"}
                value={openskyFields.clientId || ""}
                onChange={(e) => openskyFields.onClientIdChange?.(e.target.value)}
                placeholder={placeholder}
                disabled={isShared}
                className="flex-1 input"
              />
              {revealButton}
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`${provider}-client-secret`}>
              {t("settings:apiKeys.opensky.clientSecret")}
            </label>
            <input
              id={`${provider}-client-secret`}
              type={showKey ? "text" : "password"}
              value={openskyFields.clientSecret || ""}
              onChange={(e) => openskyFields.onClientSecretChange?.(e.target.value)}
              placeholder={placeholder}
              disabled={isShared}
              className="w-full input"
            />
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            disabled={isShared}
            className="flex-1 input"
          />
          {revealButton}
          {!isShared && localValue && (
            <button
              type="button"
              onClick={handleClear}
              className="btn-secondary"
              style={{ color: "var(--ts-bad)" }}
              aria-label={t("settings:apiKeys.clear")}
              title={t("settings:apiKeys.clear")}
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a
            href={getKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ts-accent)", fontWeight: 600 }}
          >
            {t("settings:apiKeys.getKey")} →
          </a>
          {isShared && <span className="t-caption">{t("settings:apiKeys.sharedNote")}</span>}
        </div>
        {testable && (
          <button
            type="button"
            onClick={handleTest}
            disabled={
              testing ||
              isShared ||
              (!localValue && !value && (!openskyFields || !openskyFields.clientId))
            }
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Icon name={testing ? "clock" : "check"} size={14} />
            {testing ? t("settings:apiKeys.testing") : t("settings:apiKeys.test")}
          </button>
        )}
      </div>
      {testResult && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md p-2 text-sm"
          style={{
            background: `color-mix(in srgb, ${token(testResult.success ? "good" : "bad")} 12%, transparent)`,
            color: token(testResult.success ? "good" : "bad"),
          }}
        >
          <Icon name={testResult.success ? "check" : "x"} size={14} />
          {testResultText(testResult)}
        </div>
      )}
    </div>
  );

  if (layout === "row") {
    return (
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <SettingRow
          title={label}
          sub={
            <span className="flex flex-col" style={{ gap: 4 }}>
              <span>{description}</span>
              {details}
            </span>
          }
          control={
            <>
              {statusPill}
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={editing}
                onClick={() => setEditing((open) => !open)}
              >
                {editing ? t("common:buttons.close") : t("common:buttons.edit")}
              </button>
            </>
          }
        />
        {editing && editor}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-lg p-4"
      style={{ gap: "var(--ts-space-md)", border: "1px solid var(--ts-border)" }}
    >
      <div className="flex flex-col" style={{ gap: 4 }}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 style={{ fontWeight: 600, color: "var(--ts-text-bright)" }}>{label}</h3>
          {statusPill}
        </div>
        <p className="t-caption">{description}</p>
        {details}
      </div>
      {editor}
    </div>
  );
}
