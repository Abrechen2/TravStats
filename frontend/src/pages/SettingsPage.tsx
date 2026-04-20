import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";
import PageTransition from "../components/PageTransition";
import { useSettingsPage } from "../components/Settings/useSettingsPage";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { DOMAINS } from "../shared/domains";
// Section components
import ProfileSection from "../components/Settings/ProfileSection";
import HomeAirportSection from "../components/Settings/HomeAirportSection";
import DisplaySection from "../components/Settings/DisplaySection";
import ModuleSection from "../components/Settings/ModuleSection";
import UnitsSection from "../components/Settings/UnitsSection";
import DefaultsSection from "../components/Settings/DefaultsSection";
import MapSection from "../components/Settings/MapSection";
import NotificationsSection from "../components/Settings/NotificationsSection";
import BackupSection from "../components/Settings/BackupSection";
import AutoUpdateSection from "../components/Settings/AutoUpdateSection";
import EnrichmentSection from "../components/Settings/EnrichmentSection";
import ApiKeysSection from "../components/Settings/ApiKeysSection";
import AdminSection from "../components/Settings/AdminSection";
import AboutSection from "../components/Settings/AboutSection";
import FeaturesSection from "../components/Settings/FeaturesSection";
import CruisePreferencesSection from "../components/Settings/CruisePreferencesSection";
import PasswordModal from "../components/Settings/PasswordModal";

type TabId = "general" | "flight" | "cruise";

interface SectionRef {
  id: string;
  label: string;
}

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { enabled: enabledDomains } = useEnabledDomains();

  const {
    user,
    profile,
    display,
    units,
    defaults,
    map,
    cruise,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setCruise,
    isDarkMode,
    savingProfile,
    uploadingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
    handleThemeToggle,
    showPasswordModal,
    changingPassword,
    passwordForm,
    setPasswordForm,
    passwordError,
    handlePasswordChange,
    closePasswordModal,
    lastBackup,
    backupStatus,
    autoUpdateSettings,
    setAutoUpdateSettings,
    loadingAutoUpdateSettings,
    saveAutoUpdateSettings,
    historicalEnrichmentSettings,
    setHistoricalEnrichmentSettings,
    loadingHistoricalEnrichmentSettings,
    saveHistoricalEnrichmentSettings,
    apiKeysStatus,
    apiKeys,
    setApiKeys,
    loadingApiKeys,
    saveApiKeys,
    setShowPasswordModal,
  } = useSettingsPage();

  // Sections are grouped into one of three tabs. The cruise group is empty
  // for now; a placeholder is shown so users see the scaffold exists.
  const sectionsByTab = useMemo<Record<TabId, SectionRef[]>>(() => {
    const general: SectionRef[] = [
      { id: "profile", label: t("settings:profile.title") || "Profile" },
      { id: "display", label: t("settings:display.title") || "Display" },
      { id: "modules", label: t("common:settings.modules.title") || "Modules" },
      { id: "units", label: t("settings:units.title") || "Units" },
      { id: "notifications", label: t("settings:notifications.title") || "Notifications" },
      { id: "features", label: t("settings:features.title") || "Features" },
      { id: "backup", label: t("settings:backup.title") || "Backup" },
      { id: "autoupdate", label: t("settings:autoUpdate.title") || "Auto-Update" },
      { id: "apikeys", label: t("settings:apiKeys.title") || "API Keys" },
      ...(user?.isAdmin ? [{ id: "admin", label: t("settings:admin.title") || "Admin" }] : []),
      { id: "about", label: "About" },
    ];
    const flight: SectionRef[] = [
      { id: "homeAirport", label: t("settings:homeAirport.title") || "Home airport" },
      { id: "defaults", label: t("settings:defaults.title") || "Defaults" },
      { id: "map", label: t("settings:map.title") || "Map" },
      { id: "enrichment", label: t("settings:historicalEnrichment.title") || "Enrichment" },
    ];
    const cruiseTab: SectionRef[] = [
      {
        id: "cruisePreferences",
        label: t("settings:cruisePreferences.title") || "Präferenzen",
      },
    ];
    return { general, flight, cruise: cruiseTab };
  }, [t, user?.isAdmin]);

  // Visible tabs: always general, plus any enabled domain that has a tab.
  // Hotel / POI have no settings yet and no tab will appear until enabled.
  const tabs = useMemo<Array<{ id: TabId; label: string; icon?: string }>>(() => {
    const list: Array<{ id: TabId; label: string; icon?: string }> = [
      { id: "general", label: t("settings:tabs.general") || "Allgemein" },
    ];
    if (enabledDomains.includes("flight")) {
      list.push({
        id: "flight",
        label: t("settings:tabs.flight") || "Flug",
        icon: DOMAINS.flight.icon,
      });
    }
    if (enabledDomains.includes("cruise")) {
      list.push({
        id: "cruise",
        label: t("settings:tabs.cruise") || "Kreuzfahrt",
        icon: DOMAINS.cruise.icon,
      });
    }
    return list;
  }, [enabledDomains, t]);

  const initialTab = (searchParams.get("tab") as TabId | null) ?? "general";
  const initialSection = searchParams.get("section");

  const [activeTab, setActiveTab] = useState<TabId>(
    tabs.some((tab) => tab.id === initialTab) ? initialTab : "general"
  );

  const currentSections = sectionsByTab[activeTab];
  const [activeSection, setActiveSection] = useState<string>(
    initialSection && currentSections.some((s) => s.id === initialSection)
      ? initialSection
      : (currentSections[0]?.id ?? "")
  );

  // Keep activeSection valid when the user switches tabs (e.g. switching
  // from flight → general while on "homeAirport" must not leave an empty
  // main area). Falls back to the first section of the new tab.
  useEffect(() => {
    if (!currentSections.some((s) => s.id === activeSection)) {
      setActiveSection(currentSections[0]?.id ?? "");
    }
  }, [activeTab, activeSection, currentSections]);

  // Reset activeTab if the user disables the domain whose tab they're on
  // (e.g. cruise tab active, then user toggles cruise off via the Modules
  // section). Without this, the tab bar no longer shows the tab but the
  // main area still renders sections belonging to it — a split-brain UI
  // state only cleared by a page reload.
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("general");
    }
  }, [tabs, activeTab]);

  // Legacy deep-link support: someone bookmarked /settings#homeAirport
  // before the tab refactor. Translate a matching hash to the correct tab
  // + section once on mount.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    for (const tab of ["general", "flight", "cruise"] as TabId[]) {
      if (sectionsByTab[tab].some((s) => s.id === hash)) {
        setActiveTab(tab);
        setActiveSection(hash);
        // strip the hash so the URL reads cleanly afterwards
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL params so reload + copy-link preserves state. Replace rather
  // than push so the browser Back button steps through user history, not
  // every internal section switch.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", activeTab);
    if (activeSection) next.set("section", activeSection);
    else next.delete("section");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeSection]);

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />

        {/* Top tab bar — one row above the settings sidebar/main split */}
        <div
          className="px-4 pt-3"
          style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="mx-auto flex max-w-6xl gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={(): void => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab.icon && (
                  <span className="mr-1.5" aria-hidden>
                    {tab.icon}
                  </span>
                )}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-[calc(100vh-3.5rem-2.75rem)]">
          {/* Sidebar — scoped to the current tab's sections */}
          <aside
            className="w-52 flex-shrink-0 flex-col py-4 overflow-y-auto hidden md:flex"
            style={{
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            <nav className="space-y-0.5 px-2">
              {currentSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: activeSection === section.id ? "var(--bg-elevated)" : "transparent",
                    color: activeSection === section.id ? "var(--accent)" : "var(--text-muted)",
                    borderLeft:
                      activeSection === section.id
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Right content area */}
          <main className="flex-1 overflow-y-auto p-6 space-y-6">
            {activeSection === "cruisePreferences" && (
              <CruisePreferencesSection cruise={cruise} onSetCruise={setCruise} />
            )}

            {activeSection === "profile" && (
              <ProfileSection
                profile={profile}
                savingProfile={savingProfile}
                uploadingProfilePicture={uploadingProfilePicture}
                onSaveProfile={saveProfileSettings}
                onAvatarUpload={handleAvatarUpload}
                onSetProfile={setProfile}
                onShowPasswordModal={() => setShowPasswordModal(true)}
              />
            )}
            {activeSection === "homeAirport" && <HomeAirportSection />}
            {activeSection === "display" && (
              <DisplaySection
                display={display}
                isDarkMode={isDarkMode}
                onSetDisplay={setDisplay}
                onThemeToggle={handleThemeToggle}
              />
            )}
            {activeSection === "modules" && <ModuleSection />}
            {activeSection === "units" && <UnitsSection units={units} onSetUnits={setUnits} />}
            {activeSection === "defaults" && (
              <DefaultsSection defaults={defaults} onSetDefaults={setDefaults} />
            )}
            {activeSection === "map" && <MapSection map={map} onSetMap={setMap} />}
            {activeSection === "notifications" && <NotificationsSection />}
            {activeSection === "features" && <FeaturesSection />}
            {activeSection === "backup" && (
              <BackupSection
                lastBackup={lastBackup}
                backupStatus={backupStatus}
                isAdmin={user?.isAdmin ?? false}
              />
            )}
            {activeSection === "autoupdate" && (
              <AutoUpdateSection
                autoUpdateSettings={autoUpdateSettings}
                loadingAutoUpdateSettings={loadingAutoUpdateSettings}
                onSetAutoUpdateSettings={setAutoUpdateSettings}
                onSave={saveAutoUpdateSettings}
              />
            )}
            {activeSection === "enrichment" && (
              <EnrichmentSection
                historicalEnrichmentSettings={historicalEnrichmentSettings}
                loadingHistoricalEnrichmentSettings={loadingHistoricalEnrichmentSettings}
                onSetHistoricalEnrichmentSettings={setHistoricalEnrichmentSettings}
                onSave={saveHistoricalEnrichmentSettings}
              />
            )}
            {activeSection === "apikeys" && (
              <ApiKeysSection
                apiKeysStatus={apiKeysStatus}
                apiKeys={apiKeys}
                loadingApiKeys={loadingApiKeys}
                onSetApiKeys={setApiKeys}
                onSave={saveApiKeys}
              />
            )}
            {activeSection === "admin" && user?.isAdmin && <AdminSection />}
            {activeSection === "about" && <AboutSection />}

            {/* Auto-saved notice */}
            <div
              className="rounded-lg p-4 text-sm flex items-center justify-between"
              style={{
                background: "rgba(63,185,80,0.08)",
                border: "1px solid rgba(63,185,80,0.2)",
              }}
            >
              <div>
                <p className="font-semibold" style={{ color: "var(--success)" }}>
                  {t("settings:autoSaved.title")}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{t("settings:autoSaved.description")}</p>
              </div>
              <button
                className="btn-secondary"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              >
                {t("settings:scrollToTop")}
              </button>
            </div>
          </main>
        </div>
      </div>

      {showPasswordModal && (
        <PasswordModal
          passwordForm={passwordForm}
          passwordError={passwordError}
          changingPassword={changingPassword}
          onClose={closePasswordModal}
          onSubmit={handlePasswordChange}
          onSetPasswordForm={setPasswordForm}
        />
      )}
    </PageTransition>
  );
}
