import OpenDataCard from "../../components/Settings/OpenDataCard";
import { useToursVisible } from "../../hooks/useToursVisible";
import type { SettingsSectionId } from "./settingsModel";
import type { useSettingsPage } from "../../components/Settings/useSettingsPage";

import ProfileSection from "../../components/Settings/ProfileSection";
import HomeAirportSection from "../../components/Settings/HomeAirportSection";
import DisplaySection from "../../components/Settings/DisplaySection";
import DomainColorSection from "../../components/Settings/DomainColorSection";
import ModuleSection from "../../components/Settings/ModuleSection";
import UnitsSection from "../../components/Settings/UnitsSection";
import CountryCountingCard from "../../components/Settings/CountryCountingCard";
import DefaultsSection from "../../components/Settings/DefaultsSection";
import NotificationsSection from "../../components/Settings/NotificationsSection";
import BackupSection from "../../components/Settings/BackupSection";
import SpreadsheetSection from "../../components/Settings/SpreadsheetSection";
import TrackArchiveSection from "../../components/Settings/TrackArchiveSection";
import AutoUpdateSection from "../../components/Settings/AutoUpdateSection";
import EnrichmentSection from "../../components/Settings/EnrichmentSection";
import ApiKeysSection from "../../components/Settings/ApiKeysSection";
import ApiTokensSection from "../../components/Settings/ApiTokensSection";
import SecuritySection from "../../components/Settings/SecuritySection";
import DevicesSection from "../../components/Settings/DevicesSection";
import AboutSection from "../../components/Settings/AboutSection";
import ImportSection from "../../components/Settings/ImportSection";
import FeaturesSection from "../../components/Settings/FeaturesSection";
import CruisePreferencesSection from "../../components/Settings/CruisePreferencesSection";
import MembershipsSection from "../../components/Settings/MembershipsSection";
import GeocoderSettingsCard from "../../components/Settings/GeocoderSettingsCard";
import RoutingProviderSection from "../../components/Settings/RoutingProviderSection";
import ImmichConnectionCard from "../../components/Settings/ImmichConnectionCard";
import DawarichConnectionCard from "../../components/Settings/DawarichConnectionCard";
import RailProvidersCard from "../../components/Settings/RailProvidersCard";
import StravaConnectionCard from "../../components/Settings/StravaConnectionCard";

type SettingsPageState = ReturnType<typeof useSettingsPage>;

interface SettingsSectionSwitchProps {
  section: SettingsSectionId;
  page: SettingsPageState;
}

/**
 * Renders one section. Kept apart from the page so the page is about
 * navigation — which group, which sections, which are gated — and this file is
 * about wiring, which is the part that grows with every new setting.
 */
export default function SettingsSectionSwitch({
  section,
  page,
}: SettingsSectionSwitchProps): JSX.Element | null {
  const isAdmin = page.user?.isAdmin ?? false;
  const toursVisible = useToursVisible();

  switch (section) {
    case "profile":
      return (
        <ProfileSection
          profile={page.profile}
          uploadingProfilePicture={page.uploadingProfilePicture}
          removingProfilePicture={page.removingProfilePicture}
          onAvatarUpload={page.handleAvatarUpload}
          onAvatarDelete={page.handleAvatarDelete}
          onSetProfile={page.setProfile}
        />
      );
    case "security":
      return <SecuritySection onChangePassword={() => page.setShowPasswordModal(true)} />;
    case "apitokens":
      return <ApiTokensSection />;
    case "devices":
      return <DevicesSection />;
    case "display":
      return <DisplaySection display={page.display} onSetDisplay={page.setDisplay} />;
    case "units":
      return (
        <UnitsSection
          units={page.units}
          onSetUnits={page.setUnits}
          baseCurrency={page.baseCurrency}
          onSetBaseCurrency={page.setBaseCurrency}
        />
      );
    case "domainColors":
      // Its own entry now. It used to be nested inside "Anzeige", where the one
      // control that repaints every map and legend was three scrolls below the
      // language picker.
      return <DomainColorSection />;
    case "modules":
      return <ModuleSection />;
    case "countryCounting":
      return <CountryCountingCard />;
    case "backup":
      return (
        <BackupSection
          lastBackup={page.lastBackup}
          backupStatus={page.backupStatus}
          isAdmin={isAdmin}
        >
          {/* In the same card as the backup, because both answer "get my data
              out" — but they are not the same thing: a backup restores an
              instance, the spreadsheet is for reading and editing. */}
          <SpreadsheetSection />
          {/* The recordings the spreadsheet cannot carry. */}
          <TrackArchiveSection />
        </BackupSection>
      );
    case "import":
      return <ImportSection />;
    case "notifications":
      return <NotificationsSection />;
    case "about":
      return <AboutSection />;
    case "externalServices":
      return (
        <div className="space-y-4">
          <ApiKeysSection
            apiKeysStatus={page.apiKeysStatus}
            apiKeys={page.apiKeys}
            loadingApiKeys={page.loadingApiKeys}
            onSetApiKeys={page.setApiKeys}
            onSave={page.saveApiKeys}
          />
          {/* Admin-only. It was also behind the tours gate until 2026-09-18,
              because tours were its only consumer and an instance with beta
              off would have offered routing for a feature hidden everywhere
              else. Tours shipped, so the gate went with them. */}
          {/* Routing serves tours and roadtrips only, and both went back
              behind the roadtrips beta key on 2026-09-24 — a routing card for
              a feature hidden everywhere else would offer nothing. */}
          {toursVisible && <RoutingProviderSection isAdmin={isAdmin} />}
          {/* Admin-only, and only where the rail domain is offered (beta). */}
          <RailProvidersCard isAdmin={isAdmin} />
          <ImmichConnectionCard />
          {/* It had a key of its OWN rather than riding on `tourRoutes`, because
              tours stopped being the only consumer the moment cruise legs were
              scoped onto the same connection. Both keys left the registry on
              2026-09-18. */}
          <DawarichConnectionCard />
          {/* Strava (2.7): day tours from Strava activities. */}
          {toursVisible && <StravaConnectionCard isAdmin={isAdmin} />}
          {/* Open data (2.7): Open-Meteo, Wikipedia, OpenStreetMap — off by default. */}
          <OpenDataCard isAdmin={isAdmin} />
        </div>
      );
    case "homeAirport":
      return <HomeAirportSection />;
    case "defaults":
      return <DefaultsSection defaults={page.defaults} onSetDefaults={page.setDefaults} />;
    case "features":
      return <FeaturesSection />;
    case "enrichment":
      return (
        <EnrichmentSection
          historicalEnrichmentSettings={page.historicalEnrichmentSettings}
          loadingHistoricalEnrichmentSettings={page.loadingHistoricalEnrichmentSettings}
          onSetHistoricalEnrichmentSettings={page.setHistoricalEnrichmentSettings}
          onSave={page.saveHistoricalEnrichmentSettings}
        />
      );
    case "autoupdate":
      return (
        <AutoUpdateSection
          autoUpdateSettings={page.autoUpdateSettings}
          loadingAutoUpdateSettings={page.loadingAutoUpdateSettings}
          onSetAutoUpdateSettings={page.setAutoUpdateSettings}
          onSave={page.saveAutoUpdateSettings}
        />
      );
    case "cruisePreferences":
      return <CruisePreferencesSection cruise={page.cruise} onSetCruise={page.setCruise} />;
    case "lodgingPreferences":
      /* Admin-only; the card itself renders null for non-admins. */
      return <GeocoderSettingsCard isAdmin={isAdmin} />;
    case "lodgingMemberships":
      return <MembershipsSection />;
    default:
      return null;
  }
}
