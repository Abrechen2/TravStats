/**
 * API Key Card Component
 *
 * Reusable component for displaying and editing API keys
 */

import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi, adminApi } from "../../lib/api";
import type { ProviderQuota } from "../../lib/api/settings";

export type ApiCardCapability = "historical365";

export interface ApiKeyCardProps {
  provider: "airlabs" | "aviationstack" | "aerodatabox" | "opensky" | "logostream" | "googlePlaces";
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
  openskyFields,
}: ApiKeyCardProps) {
  const { t } = useTranslation(["settings", "common"]);
  const [showKey, setShowKey] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
      const errorObj = error as { response?: { data?: { message?: string } }; message?: string };
      setTestResult({
        success: false,
        message: errorObj.response?.data?.message || errorObj.message || "Test fehlgeschlagen",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-(--text-primary)">{label}</h3>
            {(() => {
              // Prefer the explicit hasOwnKey signal (user cards); fall back
              // to deriving from the (masked) value for admin cards. For
              // OpenSky the fallback checks only clientId.
              const hasOwnKey =
                hasOwnKeyProp ??
                (provider === "opensky" && openskyFields ? !!openskyFields.clientId : !!value);

              // If user has own key, show "Eigener Schlüssel"
              if (hasOwnKey) {
                return (
                  <span
                    className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-sm"
                    title={t("settings:apiKeys.ownTooltip") || "Eigener API-Schlüssel eingegeben"}
                  >
                    {t("settings:apiKeys.own")}
                  </span>
                );
              }

              // If user has access (via shared key or ENV), show "Geteilt"
              if (hasAccess) {
                return (
                  <span
                    className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-sm"
                    title={
                      t("settings:apiKeys.sharedTooltip") || "Vom Administrator geteilter Schlüssel"
                    }
                  >
                    {t("settings:apiKeys.shared")}
                  </span>
                );
              }

              // Only show "Nicht konfiguriert" if no access at all
              return (
                <span
                  className="px-2 py-0.5 text-xs font-medium bg-(--bg-elevated) text-(--text-muted) rounded-sm"
                  title={
                    t("settings:apiKeys.notConfiguredTooltip") || "Kein API-Schlüssel konfiguriert"
                  }
                >
                  {t("settings:apiKeys.notConfigured")}
                </span>
              );
            })()}
          </div>
          <p className="text-sm text-(--text-muted)">{description}</p>
          {capabilities && capabilities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-2 py-0.5 text-xs font-medium rounded-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                  }}
                  title={t(`settings:apiKeys.capabilities.${cap}.tooltip`)}
                >
                  {t(`settings:apiKeys.capabilities.${cap}.label`)}
                </span>
              ))}
            </div>
          )}
          {quota && (
            <div className="mt-2 text-xs text-(--text-muted)">
              {quota.kind === "observed" && (
                <>
                  <div>
                    {t("settings:apiKeys.quota.label")}:{" "}
                    <span className="font-semibold text-(--text-primary)">
                      {quota.remaining ?? "?"}
                    </span>
                    {quota.limit !== null && <span> / {quota.limit}</span>}{" "}
                    {t("settings:apiKeys.quota.unitsSuffix")}
                  </div>
                  {quota.requestsLimit != null && quota.requestsRemaining != null && (
                    <div className="opacity-70">
                      {t("settings:apiKeys.quota.requestsLabel")}: {quota.requestsRemaining} /{" "}
                      {quota.requestsLimit}
                    </div>
                  )}
                </>
              )}
              {quota.kind === "not_reported" && (
                <span>
                  {t("settings:apiKeys.quota.notReported")}
                  {quota.knownLimitHint && (
                    <span className="ml-1">
                      ({t("settings:apiKeys.quota.staticHint", { limit: quota.knownLimitHint })})
                    </span>
                  )}
                </span>
              )}
              {quota.kind === "rate_limit_only" && (
                <span>{t("settings:apiKeys.quota.rateLimitOnly")}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {provider === "opensky" && openskyFields ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-(--text-primary) mb-1">
              {t("settings:apiKeys.opensky.clientId")}
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={openskyFields.clientId || ""}
                onChange={(e) => openskyFields.onClientIdChange?.(e.target.value)}
                placeholder={
                  isShared
                    ? t("settings:apiKeys.sharedPlaceholder")
                    : t("settings:apiKeys.enterKey")
                }
                disabled={isShared}
                className="flex-1 input"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="px-3 py-2 text-sm text-(--text-muted) hover:text-(--text-primary) border border-border rounded-md hover:bg-(--bg-base) transition-colors"
                title={showKey ? t("settings:apiKeys.hide") : t("settings:apiKeys.show")}
              >
                {showKey ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-(--text-primary) mb-1">
              {t("settings:apiKeys.opensky.clientSecret")}
            </label>
            <input
              type={showKey ? "text" : "password"}
              value={openskyFields.clientSecret || ""}
              onChange={(e) => openskyFields.onClientSecretChange?.(e.target.value)}
              placeholder={
                isShared ? t("settings:apiKeys.sharedPlaceholder") : t("settings:apiKeys.enterKey")
              }
              disabled={isShared}
              className="w-full input"
            />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={
              isShared ? t("settings:apiKeys.sharedPlaceholder") : t("settings:apiKeys.enterKey")
            }
            disabled={isShared}
            className="flex-1 input"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="px-3 py-2 text-sm text-(--text-muted) hover:text-(--text-primary) border border-border rounded-md hover:bg-(--bg-base) transition-colors"
            title={showKey ? t("settings:apiKeys.hide") : t("settings:apiKeys.show")}
          >
            {showKey ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            )}
          </button>
          {!isShared && localValue && (
            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-800"
              title={t("settings:apiKeys.clear")}
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <a
            href={getKeyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {t("settings:apiKeys.getKey")} →
          </a>
          {isShared && (
            <span className="text-(--text-muted) text-xs">
              {t("settings:apiKeys.sharedNote")}
            </span>
          )}
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
          className="btn-secondary px-3 py-1.5 text-sm flex items-center gap-2"
        >
          {testing ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {t("settings:apiKeys.testing")}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {t("settings:apiKeys.test")}
            </>
          )}
        </button>
        )}
      </div>
      {testResult && (
        <div
          className={`mt-2 p-2 rounded-md text-sm ${
            testResult.success ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}
        >
          {testResult.success ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {testResult.message}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              {testResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
