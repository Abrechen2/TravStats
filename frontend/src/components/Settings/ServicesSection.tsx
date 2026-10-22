import { useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { SectionCard, SectionTitle } from "./SettingsShared";
import {
  ServiceAccordion,
  llmServiceState,
  type ServiceGroup,
  type ServiceState,
} from "./ServiceAccordion";
import { useHasLlm } from "../../hooks/useHasLlm";
import ApiKeysSection from "./ApiKeysSection";
import PersonalRoutingKeysSection, { type RoutingKeysStatus } from "./PersonalRoutingKeysSection";
import ImmichConnectionCard from "./ImmichConnectionCard";
import PhotoJourneyNightlyScanCard from "./PhotoJourneyNightlyScanCard";
import StravaConnectionCard from "./StravaConnectionCard";
import OpenDataCard from "./OpenDataCard";
import { useExpertRows } from "./frame/useExpertRows";
import { SECTION_LABEL_KEY } from "../../pages/Settings/sectionLabels";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { useEffectiveSettingsLevel, useSettingsLevelStore } from "../../store/settingsLevelStore";
import { ExpertPill } from "../ui/ExpertPill";
import type { useSettingsPage } from "./useSettingsPage";
import type { ImmichConnectionStatus } from "../../types/immich";
import type { StravaStatus } from "../../lib/api/strava";

type PageState = ReturnType<typeof useSettingsPage>;
interface KeyStatus {
  hasKey: boolean;
  isShared: boolean;
  /** Any key reaches this account — own, the admin's, or the server environment's. */
  hasAccess?: boolean;
}

const FLIGHT_PROVIDERS = ["airlabs", "aviationstack", "aerodatabox", "aeroapi", "opensky"] as const;
const ROUTING_PROVIDERS = ["openrouteservice", "graphhopper"] as const;
const RAIL_SERVICES = ["transitous", "dbRest", "openRailRouting"] as const;
const GEOCODERS = ["photon", "nominatim"] as const;
const NAME: Record<string, string> = {
  transitous: "Transitous",
  dbRest: "db-rest",
  openRailRouting: "OpenRailRouting",
  photon: "Photon",
  nominatim: "Nominatim",
  airlabs: "AirLabs",
  aviationstack: "Aviationstack",
  aerodatabox: "AeroDataBox",
  aeroapi: "FlightAware AeroAPI",
  opensky: "OpenSky",
  openrouteservice: "OpenRouteService",
  graphhopper: "GraphHopper",
};

/**
 * A key's provider as the header counts it: own beats the instance's. A key
 * from the server's environment is the instance's too — `isShared` is false
 * for it, `hasAccess` true — and a working service must not read "Nicht
 * eingerichtet".
 */
export function keyState(status: KeyStatus | undefined): ServiceState | null {
  if (!status) return null;
  if (status.hasKey) return status.isShared ? "adminOwn" : "own";
  return status.isShared || status.hasAccess === true ? "admin" : "none";
}

function immichState(status: ImmichConnectionStatus | null): ServiceState | null {
  if (!status) return null;
  if (status.source === "user") return "own";
  return status.isShared && status.hasAccess ? "admin" : "none";
}

function stravaState(status: StravaStatus | null): ServiceState | null {
  if (!status) return null;
  if (status.connected) return "own";
  return status.configured ? "admin" : "none";
}

/**
 * Einstellungen › Dienste (forgejo#321): what the account connects, grouped
 * by domain, with what the admin already set up for everyone.
 *
 * At the standard level the page shows who provides each service and the
 * account connections (Immich, Strava); the forms for the account's OWN API
 * keys — keys that replace the instance's — are expert plumbing and stay out,
 * counted in the "weitere Einstellungen" line. Dawarich is configured where it
 * is used, under Standortverlauf; this page points there.
 */
export default function ServicesSection({ page }: { page: PageState }): JSX.Element {
  const { t } = useTranslation(["settings", "openData", "immich", "roadtrips", "common"]);
  const isAdmin = page.user?.isAdmin ?? false;
  const toursVisible = useToursVisible();
  const { isEnabled } = useEnabledDomains();
  const { colorOf } = useDomainColors();
  const openData = useSettingsStore((s) => s.openDataEnabled);
  const [immich, setImmich] = useState<ImmichConnectionStatus | null>(null);
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  // The personal routing form saves through its own endpoint call, not the
  // page's; what it last read wins over the page-load snapshot.
  const [routing, setRouting] = useState<RoutingKeysStatus | null>(null);
  const flightOn = isEnabled("flight");
  const railOn = isEnabled("rail");
  const hasLlm = useHasLlm();
  const level = useEffectiveSettingsLevel();
  const setLevel = useSettingsLevelStore((s) => s.setLevel);
  /**
   * "Eigenen Schlüssel nutzen" / "Bearbeiten" / "Einrichten" on a key row:
   * the account's own key forms sit under the group and belong to the expert
   * view, so the action switches there and brings the form into view.
   */
  const toOwnKeys = (groupId: string) => (): void => {
    if (level === "standard") setLevel("expert");
    setTimeout(() => {
      const el = document.querySelector(`[data-service-footer="${groupId}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }, 0);
  };
  /** A service the instance runs for everyone; set up in administration. */
  const instancePointer = (adminPath: string): JSX.Element =>
    isAdmin ? (
      <Link to={adminPath} className="t-caption underline">
        {t("settings:services.adminPointer")}
      </Link>
    ) : (
      <p className="t-caption">{t("settings:services.instanceOnly")}</p>
    );
  const ownKeys = (flightOn ? FLIGHT_PROVIDERS.length : 0) + (toursVisible ? 2 : 0);
  const expert = useExpertRows(ownKeys);
  const status = page.apiKeysStatus as Record<string, KeyStatus> | null;

  const crossGroup: ServiceGroup = {
    id: "cross",
    label: t("settings:services.groups.cross"),
    items: [
      {
        id: "immich",
        name: t("immich:title"),
        what: t("settings:services.what.immich"),
        state: immichState(immich),
        body: (
          <>
            <ImmichConnectionCard onStatus={setImmich} />
            {/* The nightly photo scan reads that library (forgejo#94). */}
            <PhotoJourneyNightlyScanCard />
          </>
        ),
      },
      {
        id: "dawarich",
        name: "Dawarich",
        what: t("settings:services.what.dawarich"),
        state: null,
        body: (
          <Link to="/settings/location?section=dawarich" className="t-caption underline">
            {t("settings:services.dawarichPointer")}
          </Link>
        ),
      },
      {
        // Only the admin sets the model up; there is no personal key for it.
        id: "llmParser",
        name: t("settings:services.names.llmParser"),
        what: t("settings:services.what.llmParser"),
        // The parser's own, account-visible answer (`/parser-capabilities`).
        state: llmServiceState(hasLlm),
        inline: true,
        body: instancePointer("/admin/parsers"),
      },
      ...(toursVisible
        ? [
            {
              id: "strava",
              name: t("roadtrips:strava.title"),
              what: t("settings:services.what.strava"),
              state: stravaState(strava),
              body: <StravaConnectionCard isAdmin={isAdmin} onStatus={setStrava} />,
            },
          ]
        : []),
      {
        id: "openData",
        name: t("openData:settings.title"),
        what: t("settings:services.what.openData"),
        state: openData === null ? null : openData ? "admin" : "none",
        body: <OpenDataCard isAdmin={isAdmin} />,
      },
    ],
  };

  const flightGroup: ServiceGroup = {
    id: "flight",
    label: t("common:domain.flight"),
    color: colorOf("flight"),
    items: FLIGHT_PROVIDERS.map((p) => ({
      id: p,
      name: NAME[p],
      what: t(`settings:services.what.${p}`),
      state: keyState(status?.[p]),
      onAction: toOwnKeys("flight"),
    })),
    footer: expert ? (
      <div className="flex flex-col" style={{ marginTop: "var(--ts-space-lg)", gap: 8 }}>
        <ExpertPill />
        <ApiKeysSection
          bare
          apiKeysStatus={page.apiKeysStatus}
          apiKeys={page.apiKeys}
          loadingApiKeys={page.loadingApiKeys}
          onSetApiKeys={page.setApiKeys}
          onSave={page.saveApiKeys}
        />
      </div>
    ) : null,
  };

  // Routing serves tours and roadtrips only, both behind the roadtrips key.
  const routingGroup: ServiceGroup = {
    id: "routing",
    label: t("settings:services.groups.routing"),
    color: colorOf("roadtrip"),
    items: ROUTING_PROVIDERS.map((p) => ({
      id: p,
      name: NAME[p],
      what: t(`settings:services.what.${p}`),
      state: keyState(routing?.[p] ?? status?.[p]),
      onAction: toOwnKeys("routing"),
    })),
    footer: expert ? (
      <div className="flex flex-col" style={{ marginTop: "var(--ts-space-lg)", gap: 8 }}>
        <ExpertPill />
        <PersonalRoutingKeysSection onStatus={setRouting} />
      </div>
    ) : null,
  };

  // The instance's own services: the timetable lookups and the rail router
  // (admin-only switches) and the geocoder (always resolved — a stored
  // address, the environment's, or the public default). No account keys.
  const railGroup: ServiceGroup = {
    id: "rail",
    label: t("common:domain.rail"),
    color: colorOf("rail"),
    items: RAIL_SERVICES.map((id) => ({
      id,
      name: NAME[id],
      what: t(`settings:services.what.${id}`),
      state: null,
    })),
    footer: instancePointer("/admin/externalServices?section=externalServices&match=Transitous"),
  };
  const mapsGroup: ServiceGroup = {
    id: "maps",
    label: t("settings:services.groups.maps"),
    items: GEOCODERS.map((id) => ({
      id,
      name: NAME[id],
      what: t(`settings:services.what.${id}`),
      state: "admin" as const,
    })),
  };

  const groups = [
    crossGroup,
    ...(flightOn ? [flightGroup] : []),
    ...(railOn ? [railGroup] : []),
    ...(toursVisible ? [routingGroup] : []),
    mapsGroup,
  ];

  return (
    <SectionCard>
      <SectionTitle
        title={t(SECTION_LABEL_KEY.externalServices)}
        description={t("settings:services.description")}
      />
      <ServiceAccordion groups={groups} initiallyOpen="cross" surface="personal" />
    </SectionCard>
  );
}
