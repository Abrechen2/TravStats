import { useState, type JSX } from "react";
import { Link } from "react-router-dom";
import ApiKeyCard, { type ApiKeyCardProps } from "../Settings/ApiKeyCard";
import ImmichGlobalSettings from "./ImmichGlobalSettings";
import OpenDataCard from "../Settings/OpenDataCard";
import OperatorLogosCard from "../Settings/OperatorLogosCard";
import RailProvidersCard, { type RailProvidersStatus } from "../Settings/RailProvidersCard";
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
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { useEffectiveSettingsLevel, useSettingsLevelStore } from "../../store/settingsLevelStore";
import GeocoderSettingsCard from "../Settings/GeocoderSettingsCard";
import { useHasLlm } from "../../hooks/useHasLlm";
import { llmServiceState } from "../Settings/ServiceAccordion";
import { ExpertPill } from "../ui/ExpertPill";
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
  /** Stored columns the server cannot decrypt (written under another key). */
  undecryptableKeys?: string[];
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
  const { colorOf } = useDomainColors();
  const openData = useSettingsStore((s) => s.openDataEnabled);
  // Who may bring their own keys (2) and where the geocoder lives (2).
  const expert = useExpertRows(4);
  const level = useEffectiveSettingsLevel();
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  /** A row whose settings sit under its group: bring them into view, at expert if they are. */
  const toFooter = (groupId: string, needsExpert: boolean) => (): void => {
    if (needsExpert && level === "standard") setLevel("expert");
    setTimeout(() => {
      const el = document.querySelector(`[data-service-footer="${groupId}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 0);
  };
  // Keyless services have no key to count: one that is switched on is active
  // for everyone (beta.23 UAT: "0 für alle aktiv" with both lookups on).
  const [rail, setRail] = useState<RailProvidersStatus | null>(null);
  const hasLlm = useHasLlm();
  const keys = globalApiKeys;
  const loaded = keys !== null && parserSettings !== null;
  // A stored key the server cannot decrypt serves nobody; it reads "nicht
  // eingerichtet" like a missing one, but says why (beta.22 UAT).
  const undecryptableNotice = (field: string): string | undefined =>
    keys?.undecryptableKeys?.includes(field) ? t("admin:globalApiKeys.undecryptable") : undefined;

  const keyItem = (p: KeyProvider): ServiceItem => ({
    id: p.provider,
    name: p.name,
    what: t(`settings:services.what.${p.provider}`),
    state: keys ? (keys[p.field] ? "admin" : "none") : null,
    notice: undecryptableNotice(p.field),
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
    notice:
      undecryptableNotice("globalOpenskyClientId") ??
      undecryptableNotice("globalOpenskyClientSecret"),
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
        {
          // Set up on its own page; the row says whether it is.
          id: "llmParser",
          name: t("settings:services.names.llmParser"),
          what: t("settings:services.what.llmParser"),
          // The parser's own answer (`/parser-capabilities`), never a second
          // reading of the settings that could disagree with it (Codex review).
          state: llmServiceState(hasLlm),
          inline: true,
          body: (
            <Link to="/admin/parsers" className="t-caption underline">
              {t("settings:services.parserPointer")}
            </Link>
          ),
        },
        {
          id: "operatorLogos",
          name: t("admin:operatorLogos.title"),
          what: t("settings:services.what.operatorLogos"),
          state: null,
          body: <OperatorLogosCard />,
        },
      ],
    },
    {
      id: "flight",
      label: t("common:domain.flight"),
      color: colorOf("flight"),
      items: [...FLIGHT_KEYS.map(keyItem), opensky],
    },
    {
      id: "rail",
      label: t("common:domain.rail"),
      color: colorOf("rail"),
      items: [
        {
          id: "transitous",
          name: "Transitous",
          what: t("settings:services.what.transitous"),
          state: rail ? (rail.railTransitousEnabled ? "admin" : "none") : null,
          onAction: toFooter("rail", false),
        },
        {
          id: "dbRest",
          name: "db-rest",
          what: t("settings:services.what.dbRest"),
          state: rail ? (rail.railDbRestEnabled ? "admin" : "none") : null,
          onAction: toFooter("rail", false),
        },
        {
          id: "openRailRouting",
          name: "OpenRailRouting",
          what: t("settings:services.what.openRailRouting"),
          state: rail ? (rail.railRoutingUrl ? "admin" : "none") : null,
          // Where a self-hosted router lives is expert plumbing.
          onAction: toFooter("rail", true),
        },
      ] satisfies ServiceItem[],
      footer: <RailProvidersCard isAdmin onStatus={setRail} />,
    },
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
    {
      // Moved here from Administration › Instanz (forgejo#321 prototype). The
      // instance always resolves both — a stored address, the environment's or
      // the public default — so both are in use; where they point is expert.
      id: "maps",
      label: t("settings:services.groups.maps"),
      items: (["photon", "nominatim"] as const).map((id) => ({
        id,
        name: id === "photon" ? "Photon" : "Nominatim",
        what: t(`settings:services.what.${id}`),
        state: "admin" as const,
        onAction: toFooter("maps", true),
      })),
      footer: expert ? (
        <div className="flex flex-col" style={{ marginTop: "var(--ts-space-lg)", gap: 8 }}>
          <ExpertPill />
          <GeocoderSettingsCard isAdmin />
        </div>
      ) : null,
    },
  ];

  return (
    <SectionCard>
      <SectionTitle
        title={t(ADMIN_SECTION_LABEL_KEY.externalServices)}
        description={t("admin:globalApiKeys.description")}
      />
      {!loaded && <p className="t-caption">{t("common:loading.default")}</p>}
      <ServiceAccordion groups={groups} initiallyOpen="cross" surface="admin" />

      {loaded && expert && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <h3 className="t-label-mono">{t("admin:globalApiKeys.permissions")}</h3>
          <p className="t-caption">{t("admin:globalApiKeys.permissionsDescription")}</p>
          <SettingRows>
            <Switch
              id="allow-user-parser-keys"
              expert
              checked={parserSettings.allowUserApiKeys}
              onChange={(on) => onParserSettingsChange({ allowUserApiKeys: on })}
              label={t("admin:globalApiKeys.allowUserParserApiKeys")}
              sub={t("admin:globalApiKeys.allowUserParserApiKeysDescription")}
            />
            <Switch
              id="allow-user-flight-keys"
              expert
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
