import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";
import PageTransition from "../components/PageTransition";
import { useSettingsPage } from "../components/Settings/useSettingsPage";
import { useDomainTabs } from "../hooks/useDomainTabs";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
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
import ApiTokensSection from "../components/Settings/ApiTokensSection";
import DevicesSection from "../components/Settings/DevicesSection";
import AdminSection from "../components/Settings/AdminSection";
import AboutSection from "../components/Settings/AboutSection";
import ImportSection from "../components/Settings/ImportSection";
import FeaturesSection from "../components/Settings/FeaturesSection";
import CruisePreferencesSection from "../components/Settings/CruisePreferencesSection";
import LodgingPreferencesSection from "../components/Settings/LodgingPreferencesSection";
import GeocoderSettingsCard from "../components/Settings/GeocoderSettingsCard";
import PasswordModal from "../components/Settings/PasswordModal";

type TabId = "general" | "flight" | "cruise" | "lodging";

interface SectionRef {
  id: string;
  label: string;
}

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    user,
    profile,
    display,
    units,
    defaults,
    map,
    cruise,
    baseCurrency,
    setProfile,
    setDisplay,
    setUnits,
    setDefaults,
    setMap,
    setCruise,
    setBaseCurrency,
    savingProfile,
    uploadingProfilePicture,
    removingProfilePicture,
    saveProfileSettings,
    handleAvatarUpload,
    handleAvatarDelete,
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

  const { isFeatureVisible } = useBetaFeatures();

  // ── Section MODEL vs section NAV ────────────────────────────────────────
  // `sectionsByTab` is the MODEL: every section that EXISTS and can render.
  // It is what the validation / deep-link effects below consult, so a section
  // stays reachable by URL even when it is not advertised anywhere.
  //
  // `navSectionsByTab` (further down) is what the sidebar and the mobile
  // picker actually LIST. The two are not the same thing, and conflating them
  // is exactly the trap: `devices` is hidden from the nav behind the beta gate
  // but MUST still open at /settings?section=devices — it is the only way to
  // pair a phone until the mobile app ships (see config/betaFeatures.ts).
  // Removing it from the model would bounce that URL back to "profile".
  //
  // Sections are grouped into one of four tabs. The cruise group is empty
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
      { id: "import", label: t("settings:import.title") || "Import" },
      { id: "autoupdate", label: t("settings:autoUpdate.title") || "Auto-Update" },
      { id: "apikeys", label: t("settings:apiKeys.title") || "API Keys" },
      { id: "devices", label: t("settings:devices.title") || "Devices" },
      { id: "apitokens", label: t("settings:apiTokens.title") || "API Tokens" },
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
    const lodgingTab: SectionRef[] = [
      {
        id: "lodgingPreferences",
        label: t("settings:lodgingPreferences.title") || "Präferenzen",
      },
    ];
    return { general, flight, cruise: cruiseTab, lodging: lodgingTab };
  }, [t, user?.isAdmin]);

  // The NAV list — the model minus everything the beta gate hides. Rendering
  // reads this; validation and deep-linking never do.
  const navSectionsByTab = useMemo<Record<TabId, SectionRef[]>>(() => {
    const isHidden = (id: string): boolean =>
      id === "devices" && !isFeatureVisible("devicePairing");
    return {
      general: sectionsByTab.general.filter((s) => !isHidden(s.id)),
      flight: sectionsByTab.flight.filter((s) => !isHidden(s.id)),
      cruise: sectionsByTab.cruise.filter((s) => !isHidden(s.id)),
      lodging: sectionsByTab.lodging.filter((s) => !isHidden(s.id)),
    };
  }, [sectionsByTab, isFeatureVisible]);

  // Visible tabs + active-tab state + URL sync + drift guard now live
  // in the shared useDomainTabs hook. Hotel / POI tabs plug in via the
  // same requiresDomain pattern when those domains add settings.
  const { tabs, activeTab, setActiveTab } = useDomainTabs<TabId>({
    tabConfig: [
      { id: "general", label: t("settings:tabs.general") || "Allgemein" },
      {
        id: "flight",
        label: t("settings:tabs.flight") || "Flug",
        icon: DOMAINS.flight.icon,
        requiresDomain: "flight",
      },
      {
        id: "cruise",
        label: t("settings:tabs.cruise") || "Kreuzfahrt",
        icon: DOMAINS.cruise.icon,
        requiresDomain: "cruise",
      },
      {
        id: "lodging",
        label: t("settings:tabs.lodging") || "Unterkünfte",
        icon: DOMAINS.lodging.icon,
        requiresDomain: "lodging",
      },
    ],
    defaultTab: "general",
  });

  // Reflect the current tab in the browser tab / history entry so back
  // navigation and Ctrl+Tab are readable. Restores previous title on
  // unmount so we don't leak "TravStats – Settings – Flug" into other
  // pages.
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "";
  useDocumentTitle(
    activeTabLabel
      ? `TravStats – ${t("settings:title", { defaultValue: "Einstellungen" })} – ${activeTabLabel}`
      : null
  );

  const initialSection = searchParams.get("section");

  // MODEL for the active tab — drives initial state, drift correction and the
  // deep-link effects. NOT the nav (see navSectionsByTab above).
  const currentSections = sectionsByTab[activeTab];
  const currentNavSections = navSectionsByTab[activeTab];
  const [activeSection, setActiveSection] = useState<string>(
    // Validate the deep-linked section against the MODEL — a gated-but-real
    // section (devices) must be honoured here, not bounced to "profile".
    initialSection && currentSections.some((s) => s.id === initialSection)
      ? initialSection
      : (navSectionsByTab[activeTab][0]?.id ?? currentSections[0]?.id ?? "")
  );

  // Keep activeSection valid when the user switches tabs (e.g. switching
  // from flight → general while on "homeAirport" must not leave an empty
  // main area). Validity is judged against the MODEL, so a hidden-but-real
  // section survives; the fallback lands on the first *visible* section of the
  // new tab. The useDomainTabs hook takes care of activeTab drift when a
  // domain is disabled mid-session — this effect only handles the section half.
  useEffect(() => {
    if (!currentSections.some((s) => s.id === activeSection)) {
      setActiveSection(currentNavSections[0]?.id ?? currentSections[0]?.id ?? "");
    }
  }, [activeTab, activeSection, currentSections, currentNavSections]);

  // Legacy deep-link support: someone bookmarked /settings#homeAirport
  // before the tab refactor. Translate a matching hash to the correct tab
  // + section once on mount.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    for (const tab of ["general", "flight", "cruise", "lodging"] as TabId[]) {
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

  // Cross-tab section deep-link: a user opens /settings?section=cruisePreferences
  // without ?tab=cruise (common when copy-pasting a link from a chat or
  // when an old bookmark only had the section). Without this, useDomainTabs
  // defaults activeTab to "general" and the section-drift effect snaps
  // activeSection back to "profile", silently dropping the user on the
  // wrong page. Run once on mount: if the initial `?section=` lives in a
  // non-default tab, switch to that tab before the drift effect fires.
  useEffect(() => {
    if (!initialSection) return;
    if (sectionsByTab[activeTab].some((s) => s.id === initialSection)) return;
    for (const tab of ["general", "flight", "cruise", "lodging"] as TabId[]) {
      if (sectionsByTab[tab].some((s) => s.id === initialSection)) {
        setActiveTab(tab);
        setActiveSection(initialSection);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bundle tab + section URL writes into a single setSearchParams call.
  // Two independent effects used to race because React Router does NOT
  // sequence functional setSearchParams updates (see useDomainTabs for
  // the full rationale). One effect here is the canonical pattern —
  // other multi-domain pages should mirror it.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", activeTab);
        if (activeSection) next.set("section", activeSection);
        else next.delete("section");
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeSection]);

  return (
    <PageTransition>
      <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
        <NavigationBar />

        {/* Top tab bar — domain switch (Allgemein / Flug / Kreuzfahrt).
            The sidebar below picks a section *within* the active tab,
            so this row is the higher-level axis. Pill-style with the
            page title on the left clarifies the hierarchy: domain group
            up here, section navigation down there. */}
        <div
          className="px-4 py-3"
          style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {t("settings:title", { defaultValue: "Einstellungen" })}
            </h1>
            <div
              role="tablist"
              aria-label={t("settings:title", { defaultValue: "Einstellungen" })}
              className="flex gap-1 p-1 rounded-lg"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={(): void => setActiveTab(tab.id)}
                  className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
                  style={{
                    background: activeTab === tab.id ? "var(--bg-elevated)" : "transparent",
                    color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
                  }}
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
        </div>

        {/* Mobile section picker — visible below md, replaces the sidebar
            so users on phones can still switch sections. The desktop
            sidebar takes over from md upward. */}
        <div
          className="md:hidden px-4 py-2 sticky top-0 z-10"
          style={{
            background: "var(--bg-base)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <label htmlFor="settings-section-picker" className="sr-only">
            {t("settings:sectionPicker", { defaultValue: "Section" })}
          </label>
          {/* Nav — lists only visible sections. When the user deep-linked to a
              gated section (e.g. ?section=devices) the picker has no matching
              option, so it shows blank rather than lying about what's on
              screen; the section itself still renders below. */}
          <select
            id="settings-section-picker"
            value={currentNavSections.some((s) => s.id === activeSection) ? activeSection : ""}
            onChange={(e): void => setActiveSection(e.target.value)}
            className="input w-full"
          >
            {currentNavSections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex md:h-[calc(100vh-3.5rem-3.75rem)]">
          {/* Desktop sidebar — scoped to the current tab's sections */}
          <aside
            className="w-52 flex-shrink-0 flex-col py-4 overflow-y-auto hidden md:flex"
            style={{
              background: "var(--bg-surface)",
              borderRight: "1px solid var(--color-border)",
            }}
          >
            <nav className="space-y-0.5 px-2">
              {currentNavSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: activeSection === section.id ? "var(--bg-elevated)" : "transparent",
                    color: activeSection === section.id ? "var(--accent)" : "var(--text-secondary)",
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
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {activeSection === "cruisePreferences" && (
              <CruisePreferencesSection cruise={cruise} onSetCruise={setCruise} />
            )}
            {activeSection === "lodgingPreferences" && (
              <>
                <LodgingPreferencesSection
                  baseCurrency={baseCurrency}
                  onSetBaseCurrency={setBaseCurrency}
                />
                {/* Admin-only; the card itself renders null for non-admins so
                    the Präferenzen section stays unchanged for everyone else. */}
                <GeocoderSettingsCard isAdmin={user?.isAdmin ?? false} />
              </>
            )}

            {activeSection === "profile" && (
              <ProfileSection
                profile={profile}
                savingProfile={savingProfile}
                uploadingProfilePicture={uploadingProfilePicture}
                removingProfilePicture={removingProfilePicture}
                onSaveProfile={saveProfileSettings}
                onAvatarUpload={handleAvatarUpload}
                onAvatarDelete={handleAvatarDelete}
                onSetProfile={setProfile}
                onShowPasswordModal={() => setShowPasswordModal(true)}
              />
            )}
            {activeSection === "homeAirport" && <HomeAirportSection />}
            {activeSection === "display" && (
              <DisplaySection display={display} onSetDisplay={setDisplay} />
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
            {/* Intentionally NOT gated: the nav entry is hidden behind the
                beta flag, but the section itself must still render for anyone
                who reaches /settings?section=devices directly — that URL is
                the only remaining way to pair a phone. */}
            {activeSection === "devices" && <DevicesSection />}
            {activeSection === "apitokens" && <ApiTokensSection />}
            {activeSection === "import" && <ImportSection />}
            {activeSection === "admin" && user?.isAdmin && <AdminSection />}
            {activeSection === "about" && <AboutSection />}

            {/* Auto-saved notice — compact strip; the verbose two-line
                version was visually heavy on small viewports where the
                whole settings page already scrolls. Single row with the
                scroll-to-top action collapsed to an icon button. */}
            <div
              className="rounded-md px-3 py-1.5 text-xs flex items-center justify-between gap-3"
              style={{
                background: "rgba(63,185,80,0.08)",
                border: "1px solid rgba(63,185,80,0.2)",
              }}
              role="status"
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--success)" }}
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="font-medium" style={{ color: "var(--success)" }}>
                  {t("settings:autoSaved.title")}
                </span>
                <span className="truncate" style={{ color: "var(--text-muted)" }}>
                  {t("settings:autoSaved.description")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                aria-label={t("settings:scrollToTop")}
                title={t("settings:scrollToTop")}
                className="flex items-center justify-center w-7 h-7 rounded transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                  e.currentTarget.style.background = "var(--bg-elevated)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
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
