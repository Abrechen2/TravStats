import type { JSX } from "react";
import ApiKeyCard, { type ApiKeyCardProps } from "../Settings/ApiKeyCard";
import ImmichGlobalSettings from "./ImmichGlobalSettings";
import OpenDataCard from "../Settings/OpenDataCard";
import RailProvidersCard from "../Settings/RailProvidersCard";
import { InstanceRoutingProviderCard } from "../Settings/RoutingProviderSection";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";
import {
  ServiceAccordion,
  type ServiceGroup,
  type ServiceItem,
} from "../Settings/ServiceAccordion";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { Switch } from "../ui/Field";
import { SettingRows } from "../ui/SettingRow";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useDomainOffered } from "../../hooks/useDomainVisible";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { ADMIN_SECTION_LABEL_KEY } from "../../pages/Admin/adminSections";

export interface GlobalApiKeys {
  globalAirlabsApiKey?: string;
  globalAviationstackApiKey?: string;
  globalAerodataboxApiKey?: string;
  globalAeroapiApiKey?: string;
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

type KeyField =
  | "globalAirlabsApiKey"
  | "globalAviationstackApiKey"
  | "globalAerodataboxApiKey"
  | "globalAeroapiApiKey"
  | "globalLogostreamApiKey"
  | "globalGooglePlacesApiKey";

interface KeyProvider {
  provider: ApiKeyCardProps["provider"];
  name: string;
  field: KeyField;
  url: string;
}

const FLIGHT_KEYS: readonly KeyProvider[] = [
  {
    provider: "airlabs",
    name: "AirLabs",
    field: "globalAirlabsApiKey",
    url: "https://airlabs.co/account",
  },
  {
    provider: "aviationstack",
    name: "Aviationstack",
    field: "globalAviationstackApiKey",
    url: "https://aviationstack.com/signup",
  },
  {
    provider: "aerodatabox",
    name: "AeroDataBox",
    field: "globalAerodataboxApiKey",
    url: "https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing",
  },
  {
    provider: "aeroapi",
    name: "FlightAware AeroAPI",
    field: "globalAeroapiApiKey",
    url: "https://www.flightaware.com/aeroapi/portal/",
  },
];

const CROSS_KEYS: readonly KeyProvider[] = [
  {
    provider: "logostream",
    name: "Logostream",
    field: "globalLogostreamApiKey",
    url: "https://airline.logostream.dev/",
  },
  {
    provider: "googlePlaces",
    name: "Google Places",
    field: "globalGooglePlacesApiKey",
    url: "https://console.cloud.google.com/google/maps-apis/credentials",
  },
];

/**
 * Administration › Externe Dienste (forgejo#321): the instance's keys and
 * connections, as accordions per domain plus "Bereichsübergreifend" — the
 * same grouping the personal Dienste page uses, so an admin and a user look
 * for a service in the same place.
 *
 * The keys are one form with one Save, as before; the cards that save
 * themselves (routing provider, Immich, rail lookups, open data) sit in their
 * domain's group. Who may bring their own key is plumbing, and expert.
 */
export default function GlobalApiKeysManager({
  globalApiKeys,
  parserSettings,
  saving,
  onSave,
  onGlobalApiKeysChange,
  onParserSettingsChange,
}: GlobalApiKeysManagerProps): JSX.Element {
  const { t } = useTranslation(["admin", "common", "settings", "openData"]);
  const toursVisible = useToursVisible();
  const railOffered = useDomainOffered("rail");
  const { colorOf } = useDomainColors();
  const openData = useSettingsStore((s) => s.openDataEnabled);
  const expert = useExpertRows(2);
  const keys = globalApiKeys;
  const loaded = keys !== null && parserSettings !== null;

  const keyItem = (p: KeyProvider): ServiceItem => ({
    id: p.provider,
    name: p.name,
    what: t(`settings:services.what.${p.provider}`),
    state: keys ? (keys[p.field] ? "admin" : "none") : null,
    body: keys ? (
      <ApiKeyCard
        provider={p.provider}
        label={t(`admin:globalApiKeys.${p.provider}.label`)}
        description={t(`admin:globalApiKeys.${p.provider}.description`)}
        getKeyUrl={p.url}
        isShared={false}
        hasAccess={!!keys[p.field]}
        value={keys[p.field] || ""}
        onChange={(value) => onGlobalApiKeysChange({ ...keys, [p.field]: value })}
        onClear={() => onGlobalApiKeysChange({ ...keys, [p.field]: "" })}
        isAdmin
      />
    ) : null,
  });

  const opensky: ServiceItem = {
    id: "opensky",
    name: "OpenSky",
    what: t("settings:services.what.opensky"),
    state: keys ? (keys.globalOpenskyClientId ? "admin" : "none") : null,
    body: keys ? (
      <ApiKeyCard
        provider="opensky"
        label={t("admin:globalApiKeys.opensky.label")}
        description={t("admin:globalApiKeys.opensky.description")}
        getKeyUrl="https://opensky-network.org/accounts/register"
        isShared={false}
        hasAccess={!!keys.globalOpenskyClientId}
        openskyFields={{
          clientId: keys.globalOpenskyClientId || "",
          clientSecret: keys.globalOpenskyClientSecret || "",
          onClientIdChange: (value) =>
            onGlobalApiKeysChange({ ...keys, globalOpenskyClientId: value }),
          onClientSecretChange: (value) =>
            onGlobalApiKeysChange({ ...keys, globalOpenskyClientSecret: value }),
        }}
        isAdmin
      />
    ) : null,
  };

  const groups: ServiceGroup[] = [
    {
      id: "cross",
      label: t("settings:services.groups.cross"),
      items: [
        ...CROSS_KEYS.map(keyItem),
        {
          id: "immich",
          name: t("immich:title"),
          what: t("settings:services.what.immich"),
          state: null,
          body: <ImmichGlobalSettings />,
        },
        {
          id: "openData",
          name: t("openData:settings.title"),
          what: t("settings:services.what.openData"),
          state: openData === null ? null : openData ? "admin" : "none",
          body: <OpenDataCard isAdmin />,
        },
      ],
    },
    {
      id: "flight",
      label: t("common:domain.flight"),
      color: colorOf("flight"),
      items: [...FLIGHT_KEYS.map(keyItem), opensky],
    },
    ...(railOffered
      ? [
          {
            id: "rail",
            label: t("common:domain.rail"),
            color: colorOf("rail"),
            items: [
              {
                id: "railProviders",
                name: t("settings:railProviders.title"),
                state: null,
                body: <RailProvidersCard isAdmin />,
              },
            ],
          },
        ]
      : []),
    // Routing serves tours and roadtrips only, both behind the roadtrips key.
    ...(toursVisible
      ? [
          {
            id: "routing",
            label: t("settings:services.groups.routing"),
            color: colorOf("roadtrip"),
            items: [
              {
                id: "routingProvider",
                name: t("settings:routing.title"),
                state: null,
                body: <InstanceRoutingProviderCard />,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <SectionCard>
      <SectionTitle
        title={t(ADMIN_SECTION_LABEL_KEY.externalServices)}
        description={t("admin:globalApiKeys.description")}
      />
      {!loaded && <p className="t-caption">{t("common:loading.default")}</p>}
      <ServiceAccordion groups={groups} initiallyOpen={["cross", "flight"]} />

      {loaded && expert && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <h3 className="t-label-mono">{t("admin:globalApiKeys.permissions")}</h3>
          <p className="t-caption">{t("admin:globalApiKeys.permissionsDescription")}</p>
          <SettingRows>
            <Switch
              id="allow-user-parser-keys"
              checked={parserSettings.allowUserApiKeys}
              onChange={(on) => onParserSettingsChange({ allowUserApiKeys: on })}
              label={t("admin:globalApiKeys.allowUserParserApiKeys")}
              sub={t("admin:globalApiKeys.allowUserParserApiKeysDescription")}
            />
            <Switch
              id="allow-user-flight-keys"
              checked={keys.allowUserFlightApiKeys ?? true}
              onChange={(on) => onGlobalApiKeysChange({ ...keys, allowUserFlightApiKeys: on })}
              label={t("admin:globalApiKeys.allowUserFlightApiKeys")}
              sub={t("admin:globalApiKeys.allowUserFlightApiKeysDescription")}
            />
          </SettingRows>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving || !loaded} className="btn-primary">
          {saving ? t("common:buttons.saving") : t("admin:globalApiKeys.save")}
        </button>
      </div>
    </SectionCard>
  );
}
