import ApiKeyCard from "../Settings/ApiKeyCard";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export interface GlobalApiKeys {
  globalAirlabsApiKey?: string;
  globalAviationstackApiKey?: string;
  globalAerodataboxApiKey?: string;
  globalLogostreamApiKey?: string;
  globalGooglePlacesApiKey?: string;
  globalOpenskyClientId?: string;
  globalOpenskyClientSecret?: string;
  globalOpenskyUsername?: string;
  globalOpenskyPassword?: string;
  allowUserFlightApiKeys: boolean;
}

export interface ParserApiKeySettings {
  allowUserApiKeys: boolean;
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
          <h2 className="text-xl font-semibold text-(--text-primary)">
            {t("admin:globalApiKeys.title")}
          </h2>
          <p className="text-sm text-(--text-muted) mt-1">
            {t("admin:globalApiKeys.description")}
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={saving || !globalApiKeys || !parserSettings}
          className="btn-primary"
        >
          {saving ? t("common:buttons.saving") : t("admin:globalApiKeys.save")}
        </button>
      </div>

      <InlineHelp
        title={t("admin:globalApiKeys.help.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>{t("admin:globalApiKeys.help.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:globalApiKeys.help.flightTitle")}</strong>{" "}
                {t("admin:globalApiKeys.help.flight")}
              </li>
              <li>
                <strong>{t("admin:globalApiKeys.help.permissionsTitle")}</strong>{" "}
                {t("admin:globalApiKeys.help.permissions")}
              </li>
            </ul>
          </div>
        }
      />

      {(!globalApiKeys || !parserSettings) && (
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-amber)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-amber)" }}>
            {t("common:loading.default")}
          </p>
        </div>
      )}

      {globalApiKeys && parserSettings && (
        <>
          {/* Flight Lookup APIs */}
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
              {t("admin:globalApiKeys.flightApis")}
            </h3>
            <p className="text-sm text-(--text-muted) mb-4">
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
                provider="aerodatabox"
                label={t("admin:globalApiKeys.aerodatabox.label")}
                description={t("admin:globalApiKeys.aerodatabox.description")}
                getKeyUrl="https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing"
                isShared={false}
                hasAccess={!!globalApiKeys.globalAerodataboxApiKey}
                value={globalApiKeys.globalAerodataboxApiKey || ""}
                onChange={(value) =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalAerodataboxApiKey: value })
                }
                onClear={() =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalAerodataboxApiKey: "" })
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
              <ApiKeyCard
                provider="logostream"
                label={t("admin:globalApiKeys.logostream.label")}
                description={t("admin:globalApiKeys.logostream.description")}
                getKeyUrl="https://airline.logostream.dev/"
                isShared={false}
                hasAccess={!!globalApiKeys.globalLogostreamApiKey}
                value={globalApiKeys.globalLogostreamApiKey || ""}
                onChange={(value) =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalLogostreamApiKey: value })
                }
                onClear={() =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalLogostreamApiKey: "" })
                }
                isAdmin={true}
              />
              <ApiKeyCard
                provider="googlePlaces"
                label={t("admin:globalApiKeys.googlePlaces.label")}
                description={t("admin:globalApiKeys.googlePlaces.description")}
                getKeyUrl="https://console.cloud.google.com/google/maps-apis/credentials"
                isShared={false}
                hasAccess={!!globalApiKeys.globalGooglePlacesApiKey}
                value={globalApiKeys.globalGooglePlacesApiKey || ""}
                onChange={(value) =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalGooglePlacesApiKey: value })
                }
                onClear={() =>
                  onGlobalApiKeysChange({ ...globalApiKeys, globalGooglePlacesApiKey: "" })
                }
                isAdmin={true}
              />
            </div>
          </div>

          {/* User Permissions */}
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
              {t("admin:globalApiKeys.permissions")}
            </h3>
            <p className="text-sm text-(--text-muted) mb-4">
              {t("admin:globalApiKeys.permissionsDescription")}
            </p>
            <div className="space-y-4">
              {/* Parser Permissions */}
              <div className="border-b border-border pb-4">
                <h4 className="text-md font-medium text-(--text-primary) mb-3">
                  Parser-Berechtigungen
                </h4>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={parserSettings.allowUserApiKeys}
                    onChange={(e) => onParserSettingsChange({ allowUserApiKeys: e.target.checked })}
                    className="checkbox mt-1"
                  />
                  <div>
                    <span className="font-medium text-(--text-primary)">
                      {t("admin:globalApiKeys.allowUserParserApiKeys")}
                    </span>
                    <p className="text-sm text-(--text-muted)">
                      {t("admin:globalApiKeys.allowUserParserApiKeysDescription")}
                    </p>
                  </div>
                </label>
              </div>

              {/* Flight API Permissions */}
              <div>
                <h4 className="text-md font-medium text-(--text-primary) mb-3">
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
                      className="checkbox mt-1"
                    />
                    <div>
                      <span className="font-medium text-(--text-primary)">
                        {t("admin:globalApiKeys.allowUserFlightApiKeys")}
                      </span>
                      <p className="text-sm text-(--text-muted)">
                        {t("admin:globalApiKeys.allowUserFlightApiKeysDescription")}
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
