import { useEffect, useState } from "react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ApiKeyCard from "./ApiKeyCard";
import BulkRefreshCard from "./BulkRefreshCard";
import { useTranslation } from "../../hooks/useTranslation";
import { settingsApi } from "../../lib/api";
import type { ApiKeyQuotasResponse, ProviderQuota } from "../../lib/api/settings";

interface ApiKeysStatus {
  airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  aerodatabox: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
}

interface ApiKeysFormState {
  airlabsApiKey: string;
  aviationstackApiKey: string;
  aerodataboxApiKey: string;
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
  const [quotas, setQuotas] = useState<ApiKeyQuotasResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getApiKeyQuotas()
      .then((q) => {
        if (!cancelled) setQuotas(q);
      })
      .catch(() => {
        // Quota fetch failure is non-fatal — the cards render without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const quotaFor = (provider: keyof ApiKeyQuotasResponse): ProviderQuota | undefined =>
    quotas?.[provider];

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:apiKeys.title")}
        description={t("settings:apiKeys.description")}
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
              hasOwnKey={apiKeysStatus?.airlabs.hasKey || false}
              value={apiKeys.airlabsApiKey}
              quota={quotaFor("airlabs")}
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
              hasOwnKey={apiKeysStatus?.aviationstack.hasKey || false}
              value={apiKeys.aviationstackApiKey}
              quota={quotaFor("aviationstack")}
              onChange={(value) => onSetApiKeys({ ...apiKeys, aviationstackApiKey: value })}
              onClear={() => onSetApiKeys({ ...apiKeys, aviationstackApiKey: "" })}
            />
            <ApiKeyCard
              provider="aerodatabox"
              label={t("settings:apiKeys.aerodatabox.label")}
              description={t("settings:apiKeys.aerodatabox.description")}
              getKeyUrl="https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing"
              isShared={apiKeysStatus?.aerodatabox.isShared || false}
              hasAccess={apiKeysStatus?.aerodatabox.hasAccess || false}
              hasOwnKey={apiKeysStatus?.aerodatabox.hasKey || false}
              value={apiKeys.aerodataboxApiKey}
              quota={quotaFor("aerodatabox")}
              capabilities={["historical365"]}
              onChange={(value) => onSetApiKeys({ ...apiKeys, aerodataboxApiKey: value })}
              onClear={() => onSetApiKeys({ ...apiKeys, aerodataboxApiKey: "" })}
            />
            <BulkRefreshCard />
            <ApiKeyCard
              provider="opensky"
              label={t("settings:apiKeys.opensky.label")}
              description={t("settings:apiKeys.opensky.description")}
              getKeyUrl="https://opensky-network.org/accounts/register"
              isShared={apiKeysStatus?.opensky.isShared || false}
              hasAccess={apiKeysStatus?.opensky.hasAccess || false}
              hasOwnKey={apiKeysStatus?.opensky.hasKey || false}
              quota={quotaFor("opensky")}
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
