import { useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { ServiceAccordion, type ServiceGroup, type ServiceState } from "./ServiceAccordion";
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
const NAME: Record<string, string> = {
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
  const { t } = useTranslation(["settings", "openData", "immich", "roadtrips"]);
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
    })),
    footer: expert ? (
      <div style={{ marginTop: "var(--ts-space-lg)" }}>
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
    })),
    footer: expert ? (
      <div style={{ marginTop: "var(--ts-space-lg)" }}>
        <PersonalRoutingKeysSection onStatus={setRouting} />
      </div>
    ) : null,
  };

  const groups = [
    crossGroup,
    ...(flightOn ? [flightGroup] : []),
    ...(toursVisible ? [routingGroup] : []),
  ];

  return (
    <SectionCard>
      <SectionTitle
        title={t(SECTION_LABEL_KEY.externalServices)}
        description={t("settings:services.description")}
      />
      <ServiceAccordion groups={groups} initiallyOpen={["cross"]} />
    </SectionCard>
  );
}
