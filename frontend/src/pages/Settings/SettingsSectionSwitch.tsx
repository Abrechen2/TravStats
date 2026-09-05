import { useBetaFeatures } from "../../hooks/useBetaFeatures";
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
  const { isFeatureVisible } = useBetaFeatures();
  const isAdmin = page.user?.isAdmin ?? false;

  switch (section) {
    case "profile":
      return (
        <ProfileSection
          profile={page.profile}
          savingProfile={page.savingProfile}
          uploadingProfilePicture={page.uploadingProfilePicture}
          removingProfilePicture={page.removingProfilePicture}
          onSaveProfile={page.saveProfileSettings}
          onAvatarUpload={page.handleAvatarUpload}
          onAvatarDelete={page.handleAvatarDelete}
          onSetProfile={page.setProfile}
          onShowPasswordModal={() => page.setShowPasswordModal(true)}
        />
      );
    case "security":
      return <SecuritySection />;
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
        <div className="space-y-4">
          <BackupSection
            lastBackup={page.lastBackup}
            backupStatus={page.backupStatus}
            isAdmin={isAdmin}
          />
          {/* Next to the backup, because both answer "get my data out" — but
              they are not the same thing: a backup restores an instance, this
              one is for reading and editing. */}
          <SpreadsheetSection />
        </div>
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
          {/* Admin-only AND behind the tours gate. The card configures a road
              router for tour legs and has no other consumer, so on a production
              instance with beta off it would offer to set up routing for a
              feature invisible everywhere else. */}
          {isFeatureVisible("tourRoutes") && <RoutingProviderSection isAdmin={isAdmin} />}
          <ImmichConnectionCard />
          {/* Behind its OWN key, not `tourRoutes`: tours stopped being the only
              consumer the moment cruise legs were scoped onto the same
              connection. */}
          {isFeatureVisible("dawarich") && <DawarichConnectionCard />}
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
