import { SectionCard, SectionTitle } from "./SettingsShared";
import ApiKeyCard from "./ApiKeyCard";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

interface ApiKeysStatus {
  airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
}

interface ApiKeysFormState {
  airlabsApiKey: string;
  aviationstackApiKey: string;
  openskyClientId: string;
  openskyClientSecret: string;
}

interface ApiKeysSectionProps {
  apiKeysStatus: ApiKeysStatus | null;
  apiKeys: ApiKeysFormState;
  loadingApiKeys: boolean;
  onSetApiKeys: (keys: ApiKeysFormState) => void;
  onSave: () => void;
}

export default function ApiKeysSection({
  apiKeysStatus,
  apiKeys,
  loadingApiKeys,
  onSetApiKeys,
  onSave,
}: ApiKeysSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:apiKeys.title")}
        description={t("settings:apiKeys.description")}
      />
      <InlineHelp
        title={t("settings:apiKeys.help.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>{t("settings:apiKeys.help.description")}</p>
            <div>
              <p className="font-semibold">{t("settings:apiKeys.help.sharedTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:apiKeys.help.shared")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:apiKeys.help.providersTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:apiKeys.help.providers")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:apiKeys.help.securityTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:apiKeys.help.security")}</p>
            </div>
          </div>
        }
      />
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium mb-3" style={{ color: "var(--text-primary)" }}>
            {t("settings:apiKeys.flightApis")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ApiKeyCard
              provider="airlabs"
              label={t("settings:apiKeys.airlabs.label")}
              description={t("settings:apiKeys.airlabs.description")}
              getKeyUrl="https://airlabs.co/account"
              isShared={apiKeysStatus?.airlabs.isShared || false}
              hasAccess={apiKeysStatus?.airlabs.hasAccess || false}
              value={apiKeys.airlabsApiKey}
              onChange={(value) => onSetApiKeys({ ...apiKeys, airlabsApiKey: value })}
              onClear={() => onSetApiKeys({ ...apiKeys, airlabsApiKey: "" })}
            />
            <ApiKeyCard
              provider="aviationstack"
              label={t("settings:apiKeys.aviationstack.label")}
              description={t("settings:apiKeys.aviationstack.description")}
              getKeyUrl="https://aviationstack.com/signup"
              isShared={apiKeysStatus?.aviationstack.isShared || false}
              hasAccess={apiKeysStatus?.aviationstack.hasAccess || false}
              value={apiKeys.aviationstackApiKey}
              onChange={(value) => onSetApiKeys({ ...apiKeys, aviationstackApiKey: value })}
              onClear={() => onSetApiKeys({ ...apiKeys, aviationstackApiKey: "" })}
            />
            <ApiKeyCard
              provider="opensky"
              label={t("settings:apiKeys.opensky.label")}
              description={t("settings:apiKeys.opensky.description")}
              getKeyUrl="https://opensky-network.org/accounts/register"
              isShared={apiKeysStatus?.opensky.isShared || false}
              hasAccess={apiKeysStatus?.opensky.hasAccess || false}
              openskyFields={{
                clientId: apiKeys.openskyClientId,
                clientSecret: apiKeys.openskyClientSecret,
                onClientIdChange: (value) => onSetApiKeys({ ...apiKeys, openskyClientId: value }),
                onClientSecretChange: (value) =>
                  onSetApiKeys({ ...apiKeys, openskyClientSecret: value }),
              }}
            />
          </div>
        </div>
      </div>
      <div
        className="flex justify-end gap-2 pt-4"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <button
          onClick={onSave}
          disabled={loadingApiKeys}
          className="btn-primary"
          style={{ boxShadow: "0 0 16px rgba(240,169,71,0.25)" }}
        >
          {loadingApiKeys
            ? t("settings:apiKeys.saving") || "Saving..."
            : t("settings:apiKeys.save") || "Save API Keys"}
        </button>
      </div>
    </SectionCard>
  );
}
