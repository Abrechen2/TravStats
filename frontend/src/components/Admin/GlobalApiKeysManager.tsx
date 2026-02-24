import ApiKeyCard from "../Settings/ApiKeyCard";
import { useTranslation } from "../../hooks/useTranslation";

export interface GlobalApiKeys {
  globalAirlabsApiKey?: string;
  globalAviationstackApiKey?: string;
  globalOpenskyClientId?: string;
  globalOpenskyClientSecret?: string;
  globalOpenskyUsername?: string;
  globalOpenskyPassword?: string;
  allowUserFlightApiKeys: boolean;
  requireUserFlightApiKeys: boolean;
}

export interface ParserApiKeySettings {
  globalOpenaiApiKey?: string;
  globalClaudeApiKey?: string;
  allowUserApiKeys: boolean;
  requireUserApiKeys: boolean;
}

interface GlobalApiKeysManagerProps {
  globalApiKeys: GlobalApiKeys | null;
  parserSettings: ParserApiKeySettings | null;
  saving: boolean;
  onSave: () => void;
  onGlobalApiKeysChange: (keys: GlobalApiKeys) => void;
  onParserSettingsChange: (settings: ParserApiKeySettings) => void;
}

export default function GlobalApiKeysManager({
  globalApiKeys,
  parserSettings,
  saving,
  onSave,
  onGlobalApiKeysChange,
  onParserSettingsChange,
}: GlobalApiKeysManagerProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {t("admin:globalApiKeys.title")}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {t("admin:globalApiKeys.description")}
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={saving || !globalApiKeys || !parserSettings}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
        >
          {saving ? t("common:buttons.saving") : t("admin:globalApiKeys.save")}
        </button>
      </div>

      {(!globalApiKeys || !parserSettings) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">{t("common:loading") || "Loading..."}</p>
        </div>
      )}

      {globalApiKeys && parserSettings && (
        <>
          {/* Parser APIs */}
          <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              {t("admin:globalApiKeys.parserApis")}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              {t("admin:globalApiKeys.parserApisDescription")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ApiKeyCard
                provider="openai"
                label={t("admin:globalApiKeys.openai.label")}
                description={t("admin:globalApiKeys.openai.description")}
                getKeyUrl="https://platform.openai.com/api-keys"
                isShared={false}
                hasAccess={!!parserSettings.globalOpenaiApiKey}
                value={parserSettings.globalOpenaiApiKey || ""}
                onChange={(value) =>
                  onParserSettingsChange({ ...parserSettings, globalOpenaiApiKey: value })
                }
                onClear={() =>
                  onParserSettingsChange({ ...parserSettings, globalOpenaiApiKey: "" })
                }
                isAdmin={true}
              />
              <ApiKeyCard
                provider="claude"
                label={t("admin:globalApiKeys.claude.label")}
                description={t("admin:globalApiKeys.claude.description")}
                getKeyUrl="https://console.anthropic.com/settings/keys"
                isShared={false}
                hasAccess={!!parserSettings.globalClaudeApiKey}
                value={parserSettings.globalClaudeApiKey || ""}
                onChange={(value) =>
                  onParserSettingsChange({ ...parserSettings, globalClaudeApiKey: value })
                }
                onClear={() =>
                  onParserSettingsChange({ ...parserSettings, globalClaudeApiKey: "" })
                }
                isAdmin={true}
              />
            </div>
          </div>

          {/* Flight Lookup APIs */}
          <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              {t("admin:globalApiKeys.flightApis")}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              {t("admin:globalApiKeys.flightApisDescription")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ApiKeyCard
                provider="airlabs"
                label={t("admin:globalApiKeys.airlabs.label")}
                description={t("admin:globalApiKeys.airlabs.description")}
                getKeyUrl="https://airlabs.co/account"
                isShared={false}
                hasAccess={!!globalApiKeys.globalAirlabsApiKey}
                value={globalApiKeys.globalAirlabsApiKey || ""}
                onChange={(value) =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalAirlabsApiKey: value })
                }
                onClear={() => onGlobalApiKeysChange({ ...globalApiKeys, globalAirlabsApiKey: "" })}
                isAdmin={true}
              />
              <ApiKeyCard
                provider="aviationstack"
                label={t("admin:globalApiKeys.aviationstack.label")}
                description={t("admin:globalApiKeys.aviationstack.description")}
                getKeyUrl="https://aviationstack.com/signup"
                isShared={false}
                hasAccess={!!globalApiKeys.globalAviationstackApiKey}
                value={globalApiKeys.globalAviationstackApiKey || ""}
                onChange={(value) =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalAviationstackApiKey: value })
                }
                onClear={() =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalAviationstackApiKey: "" })
                }
                isAdmin={true}
              />
              <ApiKeyCard
                provider="opensky"
                label={t("admin:globalApiKeys.opensky.label")}
                description={t("admin:globalApiKeys.opensky.description")}
                getKeyUrl="https://opensky-network.org/accounts/register"
                isShared={false}
                hasAccess={!!globalApiKeys.globalOpenskyClientId}
                openskyFields={{
                  clientId: globalApiKeys.globalOpenskyClientId || "",
                  clientSecret: globalApiKeys.globalOpenskyClientSecret || "",
                  onClientIdChange: (value) =>
                    onGlobalApiKeysChange({ ...globalApiKeys, globalOpenskyClientId: value }),
                  onClientSecretChange: (value) =>
                    onGlobalApiKeysChange({ ...globalApiKeys, globalOpenskyClientSecret: value }),
                }}
                isAdmin={true}
              />
            </div>
          </div>

          {/* User Permissions */}
          <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              {t("admin:globalApiKeys.permissions")}
            </h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              {t("admin:globalApiKeys.permissionsDescription")}
            </p>
            <div className="space-y-4">
              {/* Parser API Permissions */}
              <div className="border-b border-[var(--color-border)] pb-4">
                <h4 className="text-md font-medium text-[var(--text-primary)] mb-3">
                  {t("admin:globalApiKeys.parserPermissions")}
                </h4>
                <div className="space-y-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={parserSettings.allowUserApiKeys}
                      onChange={(e) =>
                        onParserSettingsChange({
                          ...parserSettings,
                          allowUserApiKeys: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">
                        {t("admin:globalApiKeys.allowUserParserApiKeys")}
                      </span>
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("admin:globalApiKeys.allowUserParserApiKeysDescription")}
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={parserSettings.requireUserApiKeys}
                      onChange={(e) =>
                        onParserSettingsChange({
                          ...parserSettings,
                          requireUserApiKeys: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">
                        {t("admin:globalApiKeys.requireUserParserApiKeys")}
                      </span>
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("admin:globalApiKeys.requireUserParserApiKeysDescription")}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Flight API Permissions */}
              <div>
                <h4 className="text-md font-medium text-[var(--text-primary)] mb-3">
                  {t("admin:globalApiKeys.flightPermissions")}
                </h4>
                <div className="space-y-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={globalApiKeys.allowUserFlightApiKeys ?? true}
                      onChange={(e) =>
                        onGlobalApiKeysChange({
                          ...globalApiKeys,
                          allowUserFlightApiKeys: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">
                        {t("admin:globalApiKeys.allowUserFlightApiKeys")}
                      </span>
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("admin:globalApiKeys.allowUserFlightApiKeysDescription")}
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={globalApiKeys.requireUserFlightApiKeys ?? false}
                      onChange={(e) =>
                        onGlobalApiKeysChange({
                          ...globalApiKeys,
                          requireUserFlightApiKeys: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <div>
                      <span className="font-medium text-[var(--text-primary)]">
                        {t("admin:globalApiKeys.requireUserFlightApiKeys")}
                      </span>
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("admin:globalApiKeys.requireUserFlightApiKeysDescription")}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
