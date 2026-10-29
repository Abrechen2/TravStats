import type { SettingsSectionId } from "./settingsModel";
import type { useSettingsPage } from "../../components/Settings/useSettingsPage";

import ProfileSection from "../../components/Settings/ProfileSection";
import HomeCountryCard from "../../components/Settings/HomeCountryCard";
import HomeAirportSection from "../../components/Settings/HomeAirportSection";
import DisplaySection from "../../components/Settings/DisplaySection";
import UnitsSection from "../../components/Settings/UnitsSection";
import CountryCountingCard from "../../components/Settings/CountryCountingCard";
import DefaultsSection from "../../components/Settings/DefaultsSection";
import NotificationsSection from "../../components/Settings/NotificationsSection";
import BackupSection from "../../components/Settings/BackupSection";
import SpreadsheetSection from "../../components/Settings/SpreadsheetSection";
import TrackArchiveSection from "../../components/Settings/TrackArchiveSection";
import WebdavSyncRow from "../../components/Settings/WebdavSyncRow";
import AutoUpdateSection from "../../components/Settings/AutoUpdateSection";
import EnrichmentSection from "../../components/Settings/EnrichmentSection";
import ApiTokensSection from "../../components/Settings/ApiTokensSection";
import SecuritySection from "../../components/Settings/SecuritySection";
import DevicesSection from "../../components/Settings/DevicesSection";
import ImportSection from "../../components/Settings/ImportSection";
import TripsSection from "../../components/Settings/TripsSection";
import InboxSuggestionsSection from "../../components/Settings/InboxSuggestionsSection";
import TripRecordingSection from "../../components/Settings/TripRecordingSection";
import SharingSection from "../../components/Settings/SharingSection";
import RemoteSharingSection from "../../components/Settings/RemoteSharingSection";
import ShareLinksSection from "../../components/Settings/ShareLinksSection";
import CompanionsSection from "../../components/Settings/companions/CompanionsSection";
import CalendarFeedSection from "../../components/Settings/CalendarFeedSection";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import FeaturesSection from "../../components/Settings/FeaturesSection";
import CruisePreferencesSection from "../../components/Settings/CruisePreferencesSection";
import LoyaltySection from "../../components/Settings/LoyaltySection";
import ModuleSection from "../../components/Settings/ModuleSection";
import ServicesSection from "../../components/Settings/ServicesSection";
import DawarichStayScanCard from "../../components/Settings/DawarichStayScanCard";
import DawarichConnectionCard from "../../components/Settings/DawarichConnectionCard";
import LocationProviderSection from "../../components/Settings/LocationProviderSection";
import TravTrackSection from "../../components/Settings/TravTrackSection";

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
  const { isFeatureVisible } = useBetaFeatures();

  switch (section) {
    case "profile":
      return (
        <div className="space-y-4">
          <ProfileSection
            profile={page.profile}
            uploadingProfilePicture={page.uploadingProfilePicture}
            removingProfilePicture={page.removingProfilePicture}
            onAvatarUpload={page.handleAvatarUpload}
            onAvatarDelete={page.handleAvatarDelete}
            onSetProfile={page.setProfile}
          />
          {/* A personal fact like the name above; it orders booking templates. */}
          <HomeCountryCard />
        </div>
      );
    case "security":
      return <SecuritySection onChangePassword={() => page.setShowPasswordModal(true)} />;
    case "apitokens":
      return <ApiTokensSection />;
    case "devices":
      return <DevicesSection />;
    case "notifications":
      return <NotificationsSection />;
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
    case "domains":
      // The module switch and the domain colour, one row per domain
      // (forgejo#321): they were two sections that listed the same domains
      // twice, a screen apart.
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
          {/* The same export, on a schedule, to the user's own share (expert). */}
          <WebdavSyncRow />
        </BackupSection>
      );
    case "import":
      return <ImportSection />;
    case "trips":
      return <TripsSection />;
    case "suggestions":
      // Which suggestions the inbox offers at all (forgejo#306).
      return <InboxSuggestionsSection />;
    case "sharing":
      // Shared trips (design 2026-10-09): consent and companion links, then
      // people on other servers (forgejo#301), behind its beta key and the
      // server's switch.
      return (
        <div className="space-y-4">
          <SharingSection />
          {isFeatureVisible("federatedTripSharing") && <RemoteSharingSection />}
        </div>
      );
    case "companions":
      // Rename, merge and delete companions (owner, 2026-10-22).
      return <CompanionsSection />;
    case "shareLinks":
      // Public share links (forgejo#281): own links and a pointer to administration.
      return <ShareLinksSection isAdmin={isAdmin} />;
    case "calendarFeed":
      // The calendar subscription (forgejo#310), behind its beta key.
      return <CalendarFeedSection />;
    case "dawarich":
      return <DawarichConnectionCard />;
    case "locationProvider":
      // Where recordings go and positions are read from (TravTrack plan S5).
      return <LocationProviderSection />;
    case "travTrack":
      // TravTrack's own history: summary, export, zones, delete (plan T6).
      return <TravTrackSection />;
    case "tripRecording":
      // Whether the app's trip positions are stored here (forgejo#316).
      return <TripRecordingSection />;
    case "stayScan":
      return <DawarichStayScanCard />;
    case "externalServices":
      return <ServicesSection page={page} />;
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
          loadState={page.serverSettingsLoad}
          onRetryLoad={page.reloadServerSettings}
          onSetHistoricalEnrichmentSettings={page.setHistoricalEnrichmentSettings}
          onSave={page.saveHistoricalEnrichmentSettings}
        />
      );
    case "autoupdate":
      return (
        <AutoUpdateSection
          autoUpdateSettings={page.autoUpdateSettings}
          loadingAutoUpdateSettings={page.loadingAutoUpdateSettings}
          loadState={page.serverSettingsLoad}
          onRetryLoad={page.reloadServerSettings}
          onSetAutoUpdateSettings={page.setAutoUpdateSettings}
          onSave={page.saveAutoUpdateSettings}
        />
      );
    case "cruisePreferences":
      return <CruisePreferencesSection cruise={page.cruise} onSetCruise={page.setCruise} />;
    case "loyalty":
      return <LoyaltySection />;
    default:
      return null;
  }
}
