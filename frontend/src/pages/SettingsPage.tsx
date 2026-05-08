import { useState } from "react";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";
import PageTransition from "../components/PageTransition";
import { useSettingsPage } from "../components/Settings/useSettingsPage";
// Section components
import ProfileSection from "../components/Settings/ProfileSection";
import HomeAirportSection from "../components/Settings/HomeAirportSection";
import DisplaySection from "../components/Settings/DisplaySection";
import UnitsSection from "../components/Settings/UnitsSection";
import DefaultsSection from "../components/Settings/DefaultsSection";
import MapSection from "../components/Settings/MapSection";
import NotificationsSection from "../components/Settings/NotificationsSection";
import BackupSection from "../components/Settings/BackupSection";
import AutoUpdateSection from "../components/Settings/AutoUpdateSection";
import EnrichmentSection from "../components/Settings/EnrichmentSection";
import ApiKeysSection from "../components/Settings/ApiKeysSection";
import ApiTokensSection from "../components/Settings/ApiTokensSection";
import AdminSection from "../components/Settings/AdminSection";
import AboutSection from "../components/Settings/AboutSection";
import ImportSection from "../components/Settings/ImportSection";
import FeaturesSection from "../components/Settings/FeaturesSection";
import PasswordModal from "../components/Settings/PasswordModal";

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [activeSection, setActiveSection] = useState<string>("profile");

  const {
    user,
    profile,
    display,
    units,
    defaults,
    map,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    savingProfile,
    uploadingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
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

  const sections = [
    { id: "profile", label: t("settings:profile.title") || "Profile" },
    { id: "homeAirport", label: t("settings:homeAirport.title") || "Home airport" },
    { id: "display", label: t("settings:display.title") || "Display" },
    { id: "units", label: t("settings:units.title") || "Units" },
    { id: "defaults", label: t("settings:defaults.title") || "Defaults" },
    { id: "map", label: t("settings:map.title") || "Map" },
    { id: "notifications", label: t("settings:notifications.title") || "Notifications" },
    { id: "features", label: t("settings:features.title") || "Features" },
    { id: "backup", label: t("settings:backup.title") || "Backup" },
    { id: "autoupdate", label: t("settings:autoUpdate.title") || "Auto-Update" },
    { id: "enrichment", label: t("settings:historicalEnrichment.title") || "Enrichment" },
    { id: "apikeys", label: t("settings:apiKeys.title") || "API Keys" },
    { id: "apitokens", label: t("settings:apiTokens.title") || "API Tokens" },
    { id: "import", label: t("settings:import.title") || "Import" },
    ...(user?.isAdmin ? [{ id: "admin", label: t("settings:admin.title") || "Admin" }] : []),
    { id: "about", label: "About" },
  ];

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />
        <div className="flex h-[calc(100vh-3.5rem)]">
          {/* Sidebar */}
          <aside
            className="w-52 flex-shrink-0 flex-col py-4 overflow-y-auto hidden md:flex"
            style={{
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            <nav className="space-y-0.5 px-2">
              {sections.map((section) => (
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
              <DisplaySection display={display} onSetDisplay={setDisplay} />
            )}
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
            {activeSection === "apitokens" && <ApiTokensSection />}
            {activeSection === "import" && <ImportSection />}
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
